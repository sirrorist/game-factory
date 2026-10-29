CREATE TABLE "access_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "access_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"target_user_id" text NOT NULL,
	"action" text NOT NULL,
	"previous_role" text,
	"next_role" text,
	"previous_status" text,
	"next_status" text,
	"security_generation" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_events_actor_valid" CHECK ("access_events"."actor_kind" in ('operator', 'user', 'system')),
	CONSTRAINT "access_events_reason_valid" CHECK (length("access_events"."reason") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "access_lock" (
	"id" integer PRIMARY KEY NOT NULL,
	CONSTRAINT "access_lock_singleton" CHECK ("access_lock"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "security_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "security_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "access_events_target_idx" ON "access_events" USING btree ("target_user_id","created_at");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role_valid" CHECK ("user"."role" in ('user', 'developer', 'admin', 'owner'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_status_valid" CHECK ("user"."status" in ('active', 'suspended'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_security_generation_valid" CHECK ("user"."security_generation" >= 0);
--> statement-breakpoint
INSERT INTO "access_lock" ("id") VALUES (1);
--> statement-breakpoint
-- BEFORE STATEMENT берёт общую блокировку до строк user, в том числе в прямом SQL.
CREATE FUNCTION gf_lock_user_access() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.access_lock SET id = id WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'не готова блокировка изменений доступа'; END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER gf_lock_user_access BEFORE INSERT OR DELETE OR UPDATE OF role, status, security_generation
ON "user" FOR EACH STATEMENT EXECUTE FUNCTION gf_lock_user_access();
--> statement-breakpoint
-- Защита действует и при прямом UPDATE/DELETE, а не только в операторском CLI.
CREATE FUNCTION gf_guard_user_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Drizzle перечисляет DEFAULT-колонки в INSERT: ограничение только по колонкам
    -- сломало бы и безопасное создание user, поэтому новые права проверяет триггер.
    IF current_user = 'gf_hub' AND (NEW.role <> 'user' OR NEW.status <> 'active' OR NEW.security_generation <> 0) THEN
      RAISE EXCEPTION 'хаб не назначает права при создании учётки' USING ERRCODE = '23514';
    END IF;
    IF NEW.role <> 'owner' THEN RETURN NEW; END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (NEW.role, NEW.status, NEW.security_generation) IS NOT DISTINCT FROM
       (OLD.role, OLD.status, OLD.security_generation) THEN RETURN NEW; END IF;
  ELSIF OLD.role <> 'owner' OR OLD.status <> 'active' THEN
    RETURN OLD;
  END IF;

  IF TG_OP <> 'INSERT' AND OLD.role = 'owner' AND OLD.status = 'active' THEN
    IF TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NEW.status <> 'active' THEN
      IF NOT EXISTS (SELECT 1 FROM public."user" WHERE role = 'owner' AND status = 'active' AND id <> OLD.id) THEN
        RAISE EXCEPTION 'нельзя удалить, заблокировать или понизить последнего активного owner';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (NEW.role, NEW.status) IS DISTINCT FROM (OLD.role, OLD.status) THEN
      NEW.security_generation := OLD.security_generation + 1;
    ELSIF NEW.security_generation < OLD.security_generation THEN
      RAISE EXCEPTION 'нельзя уменьшать поколение безопасности';
    END IF;
    IF NEW.security_generation <> OLD.security_generation THEN
      DELETE FROM public.session WHERE user_id = OLD.id;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER gf_guard_user_access BEFORE INSERT OR DELETE OR UPDATE OF role, status, security_generation
ON "user" FOR EACH ROW EXECUTE FUNCTION gf_guard_user_access();
--> statement-breakpoint
CREATE FUNCTION gf_record_user_access() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  before_role text; before_status text; after_role text; after_status text;
  target_id text; generation integer; event_action text;
  caller_role oid; selected_role text;
  event_actor_kind text := 'system'; event_actor_id text;
  event_reason text := 'Изменение через подключение БД';
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.role, NEW.status, NEW.security_generation) IS NOT DISTINCT FROM
    (OLD.role, OLD.status, OLD.security_generation) THEN RETURN NEW; END IF;
  IF TG_OP <> 'INSERT' THEN
    before_role := OLD.role; before_status := OLD.status;
    target_id := OLD.id; generation := OLD.security_generation;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    after_role := NEW.role; after_status := NEW.status;
    target_id := NEW.id; generation := NEW.security_generation;
  END IF;
  event_action := CASE TG_OP WHEN 'INSERT' THEN 'user.created' WHEN 'DELETE' THEN 'user.deleted'
    ELSE 'access.changed' END;

  -- Custom GUC назначает любой SQL-клиент. Доверяем им только у роли с правами
  -- владельца таблицы: current_user внутри SECURITY DEFINER здесь не подходит.
  -- Встроенный role учитывает SET ROLE; без него действует SESSION_USER.
  selected_role := current_setting('role', true);
  IF selected_role IS NULL OR selected_role = 'none' THEN
    SELECT oid INTO caller_role FROM pg_catalog.pg_roles WHERE rolname = SESSION_USER;
  ELSE
    caller_role := selected_role::pg_catalog.regrole::oid;
  END IF;
  IF pg_catalog.pg_has_role(caller_role,
    (SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.access_events'::pg_catalog.regclass), 'USAGE') THEN
    event_actor_kind := coalesce(nullif(current_setting('gf.access_actor_kind', true), ''), 'system');
    event_actor_id := nullif(current_setting('gf.access_actor_id', true), '');
    event_reason := coalesce(nullif(current_setting('gf.access_reason', true), ''), event_reason);
  END IF;

  INSERT INTO public.access_events (actor_kind, actor_id, target_user_id, action,
    previous_role, next_role, previous_status, next_status, security_generation, reason)
  VALUES (event_actor_kind, event_actor_id, target_id, event_action,
    before_role, after_role, before_status, after_status, generation,
    event_reason);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER gf_record_user_access AFTER INSERT OR DELETE OR UPDATE OF role, status, security_generation
ON "user" FOR EACH ROW EXECUTE FUNCTION gf_record_user_access();
--> statement-breakpoint
CREATE FUNCTION gf_guard_session_access() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_generation integer; current_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT security_generation, status INTO current_generation, current_status
      FROM public."user" WHERE id = NEW.user_id FOR SHARE;
  ELSE
    -- UPDATE уже держит строку session: брать user-lock здесь нельзя (обратный порядок).
    -- Auth adapter держит user до UPDATE; прямой refresh не меняет принадлежность/поколение.
    IF (NEW.id, NEW.user_id, NEW.security_generation) IS DISTINCT FROM
       (OLD.id, OLD.user_id, OLD.security_generation) THEN
      RAISE EXCEPTION 'нельзя менять принадлежность или поколение сессии' USING ERRCODE = '23514';
    END IF;
    SELECT security_generation, status INTO current_generation, current_status
      FROM public."user" WHERE id = NEW.user_id;
  END IF;
  IF NOT FOUND OR current_status <> 'active' OR NEW.security_generation <> current_generation THEN
    RAISE EXCEPTION 'сессия недействительна: доступ изменён' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER gf_guard_session_access BEFORE INSERT OR UPDATE ON session
FOR EACH ROW EXECUTE FUNCTION gf_guard_session_access();
--> statement-breakpoint
-- Нельзя прикрепить SECURITY DEFINER к своей временной таблице и подделать журнал.
-- Уже созданные триггеры работают без права создавать новые с этими функциями.
REVOKE ALL ON FUNCTION gf_record_user_access() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION gf_guard_user_access() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION gf_guard_session_access() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION gf_lock_user_access() FROM PUBLIC;

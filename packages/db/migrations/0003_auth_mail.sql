CREATE TABLE "auth_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"generation" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "auth_actions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "auth_token_hash_format" CHECK ("auth_actions"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "auth_action_purpose" CHECK ("auth_actions"."purpose" in ('verify', 'reset'))
);
--> statement-breakpoint
CREATE TABLE "auth_mail_counters" (
	"key" text PRIMARY KEY NOT NULL,
	"hits" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_counter_bounded" CHECK (octet_length("auth_mail_counters"."hits") <= 65536)
);
--> statement-breakpoint
CREATE TABLE "auth_mail_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"intent_key" text NOT NULL,
	"purpose" text NOT NULL,
	"state" text NOT NULL,
	"key_id" text NOT NULL,
	"ciphertext" text,
	"action_id" text,
	"profile" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "auth_mail_operations_intent_key_unique" UNIQUE("intent_key"),
	CONSTRAINT "auth_mail_state" CHECK ("auth_mail_operations"."state" in ('pending','started','accepted','not_accepted','unknown','suppressed')),
	CONSTRAINT "auth_mail_purpose" CHECK ("auth_mail_operations"."purpose" in ('verify','reset'))
);
--> statement-breakpoint
CREATE TABLE "auth_recovery_guards" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enhanced_required" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "auth_actions_not_before" timestamp with time zone DEFAULT '1970-01-01'::timestamptz NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_actions" ADD CONSTRAINT "auth_actions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_mail_operations" ADD CONSTRAINT "auth_mail_operations_action_id_auth_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."auth_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_recovery_guards" ADD CONSTRAINT "auth_recovery_guards_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_action_user_idx" ON "auth_actions" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "auth_action_expiry_idx" ON "auth_actions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_counter_expiry_idx" ON "auth_mail_counters" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_mail_pending_idx" ON "auth_mail_operations" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "auth_mail_action_idx" ON "auth_mail_operations" USING btree ("action_id");
--> statement-breakpoint
-- Изменение доступа/адреса отзывает собственные токены и непереданные письма.
CREATE FUNCTION public.gf_revoke_auth_actions() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF (NEW.security_generation,NEW.email,NEW.status) IS DISTINCT FROM
    (OLD.security_generation,OLD.email,OLD.status) THEN
  UPDATE public.auth_actions SET revoked_at = clock_timestamp()
   WHERE user_id = NEW.id AND revoked_at IS NULL AND consumed_at IS NULL;
  UPDATE public.auth_mail_operations SET state = 'suppressed', ciphertext = NULL, finished_at = clock_timestamp()
   WHERE action_id IN (SELECT id FROM public.auth_actions WHERE user_id = NEW.id)
    AND state = 'pending';
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER gf_revoke_auth_actions AFTER UPDATE ON public."user"
 FOR EACH ROW EXECUTE FUNCTION public.gf_revoke_auth_actions();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_revoke_auth_actions() FROM PUBLIC;
--> statement-breakpoint
-- Доказательство не расширяет adapter: процедура разрешает ровно одно действие.
CREATE FUNCTION public.gf_consume_auth_action(p_token text, p_purpose text, p_password text, p_session text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a public.auth_actions%ROWTYPE; u public."user"%ROWTYPE; t timestamptz;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' OR p_purpose IS NULL OR p_purpose NOT IN ('verify','reset') THEN RETURN 'invalid'; END IF;
 UPDATE public.access_lock SET id=id WHERE id=1;
 IF NOT FOUND THEN RAISE EXCEPTION 'не готова блокировка доступа'; END IF;
 -- Только чтение до user-lock: ни токен, ни mail не блокируются раньше user.
 SELECT * INTO a FROM public.auth_actions WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 IF NOT FOUND THEN RETURN 'invalid'; END IF;
 SELECT * INTO u FROM public."user" WHERE id=a.user_id FOR UPDATE;
 SELECT * INTO a FROM public.auth_actions WHERE id=a.id FOR UPDATE;
 t := clock_timestamp();
 IF u.id IS NULL OR a.purpose<>p_purpose OR a.consumed_at IS NOT NULL OR a.revoked_at IS NOT NULL
  OR a.expires_at<=t OR u.status<>'active' OR a.generation<>u.security_generation
  OR a.email<>lower(btrim(u.email)) THEN RETURN 'invalid'; END IF;
 IF p_session IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.session s WHERE s.id=p_session
   AND s.user_id=u.id AND s.security_generation=u.security_generation AND s.expires_at>t) THEN RETURN 'conflict'; END IF;
 IF p_purpose='reset' THEN
  IF u.role NOT IN ('user','developer') OR EXISTS(SELECT 1 FROM public.auth_recovery_guards
    WHERE user_id=u.id AND enhanced_required) THEN RETURN 'invalid'; END IF;
  IF p_password IS NULL OR p_password !~ '^[a-f0-9]{32}:[a-f0-9]{128}$' THEN RETURN 'invalid'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.account WHERE user_id=u.id AND provider_id='credential') THEN RETURN 'invalid'; END IF;
  UPDATE public.account SET password=p_password, updated_at=t WHERE user_id=u.id AND provider_id='credential';
  UPDATE public.auth_actions SET consumed_at=t WHERE id=a.id;
  UPDATE public."user" SET security_generation=security_generation+1,updated_at=t WHERE id=u.id;
  DELETE FROM public.session WHERE user_id=u.id;
  DELETE FROM public.passkey WHERE user_id=u.id;
 ELSE
  IF p_password IS NOT NULL THEN RETURN 'invalid'; END IF;
  UPDATE public."user" SET email_verified=true,updated_at=t WHERE id=u.id;
  UPDATE public.auth_actions SET consumed_at=t WHERE id=a.id;
 END IF;
 RETURN 'ok';
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_consume_auth_action(text,text,text,text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.gf_auth_mail_lock() RETURNS void LANGUAGE sql
SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 UPDATE public.access_lock SET id=id WHERE id=1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_auth_mail_lock() FROM PUBLIC;
--> statement-breakpoint

-- Будущий фактор настраивается только после сериализации с почтовым reset.
CREATE TRIGGER gf_lock_auth_recovery_guards BEFORE INSERT OR UPDATE OR DELETE ON public.auth_recovery_guards
 FOR EACH STATEMENT EXECUTE FUNCTION public.gf_lock_user_access();
--> statement-breakpoint
CREATE FUNCTION public.gf_change_auth_recovery_guard() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  UPDATE public."user" SET security_generation=security_generation+1 WHERE id=OLD.user_id;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND NEW.user_id<>OLD.user_id THEN RAISE EXCEPTION 'нельзя переносить фактор'; END IF;
 UPDATE public."user" SET security_generation=security_generation+1 WHERE id=NEW.user_id;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER gf_change_auth_recovery_guard BEFORE INSERT OR UPDATE OR DELETE ON public.auth_recovery_guards
 FOR EACH ROW EXECUTE FUNCTION public.gf_change_auth_recovery_guard();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_change_auth_recovery_guard() FROM PUBLIC;

--> statement-breakpoint
CREATE FUNCTION public.gf_mark_auth_actions_not_before() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF (NEW.security_generation,NEW.email,NEW.status) IS DISTINCT FROM
   (OLD.security_generation,OLD.email,OLD.status) THEN NEW.auth_actions_not_before := clock_timestamp(); END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER gf_mark_auth_actions_not_before BEFORE UPDATE ON public."user"
 FOR EACH ROW EXECUTE FUNCTION public.gf_mark_auth_actions_not_before();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_mark_auth_actions_not_before() FROM PUBLIC;

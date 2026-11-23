CREATE SCHEMA "auth_private";
--> statement-breakpoint
CREATE TABLE "auth_private"."backup_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"set_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "backup_hash" CHECK ("auth_private"."backup_codes"."code_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "auth_private"."contexts" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"generation" integer,
	"purpose" text NOT NULL,
	"credential_id" text,
	"credential_hash" text,
	"session_id" text,
	"session_bearer_hash" text,
	"state" text DEFAULT 'active' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "context_hash" CHECK ("auth_private"."contexts"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "context_state" CHECK ("auth_private"."contexts"."state" in ('active', 'spent')),
	CONSTRAINT "context_purpose" CHECK ("auth_private"."contexts"."purpose" in ('login','reauth','password','enrol-token','enrol-cookie','setup','backup','uv-login')),
	CONSTRAINT "context_attempts" CHECK ("auth_private"."contexts"."attempts" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "auth_private"."counters" (
	"key" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"hits" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "factor_counter_domain" CHECK ("auth_private"."counters"."domain" in ('mfa', 'backup', 'issue', 'enrol', 'uv')),
	CONSTRAINT "factor_counter_bounded" CHECK (jsonb_typeof("auth_private"."counters"."hits") = 'array' and jsonb_array_length("auth_private"."counters"."hits") <= 20)
);
--> statement-breakpoint
CREATE TABLE "auth_private"."factors" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"key_id" text,
	"ciphertext" text,
	"credential_id" text,
	"fingerprint" text,
	"last_step" bigint DEFAULT -1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "factor_kind" CHECK ("auth_private"."factors"."kind" in ('totp', 'uv')),
	CONSTRAINT "factor_state" CHECK ("auth_private"."factors"."state" in ('pending', 'active')),
	CONSTRAINT "factor_material" CHECK (("auth_private"."factors"."kind" = 'totp' and "auth_private"."factors"."key_id" is not null and "auth_private"."factors"."ciphertext" is not null and "auth_private"."factors"."credential_id" is null)
    or ("auth_private"."factors"."kind" = 'uv' and "auth_private"."factors"."credential_id" is not null and "auth_private"."factors"."fingerprint" is not null and "auth_private"."factors"."ciphertext" is null))
);
--> statement-breakpoint
CREATE TABLE "auth_private"."proofs" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"generation" integer NOT NULL,
	"bearer_hash" text NOT NULL,
	"issuance_id" text NOT NULL,
	"method" text NOT NULL,
	"factor_id" text,
	"verified_at" timestamp with time zone NOT NULL,
	CONSTRAINT "proofs_issuance_id_unique" UNIQUE("issuance_id"),
	CONSTRAINT "proof_method" CHECK ("auth_private"."proofs"."method" in ('password', 'totp', 'uv')),
	CONSTRAINT "proof_bearer_hash" CHECK ("auth_private"."proofs"."bearer_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "auth_private"."reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"context_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auth_private"."backup_codes" ADD CONSTRAINT "backup_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_private"."contexts" ADD CONSTRAINT "contexts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_private"."factors" ADD CONSTRAINT "factors_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_private"."proofs" ADD CONSTRAINT "proofs_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_private"."proofs" ADD CONSTRAINT "proofs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_private"."reservations" ADD CONSTRAINT "reservations_context_hash_contexts_token_hash_fk" FOREIGN KEY ("context_hash") REFERENCES "auth_private"."contexts"("token_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_user_idx" ON "auth_private"."backup_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "context_expiry_idx" ON "auth_private"."contexts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "context_user_idx" ON "auth_private"."contexts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "factor_counter_expiry_idx" ON "auth_private"."counters" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "factor_user_idx" ON "auth_private"."factors" USING btree ("user_id","kind","state");--> statement-breakpoint
CREATE INDEX "reservation_context_idx" ON "auth_private"."reservations" USING btree ("context_hash");
--> statement-breakpoint
REVOKE ALL ON SCHEMA auth_private FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA auth_private FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.gf_b_hash(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
  SELECT encode(sha256(convert_to(value, 'UTF8')), 'hex');
$$;
--> statement-breakpoint
CREATE FUNCTION public.gf_b_required(uid text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT coalesce((SELECT u.role IN ('admin','owner') OR EXISTS
    (SELECT 1 FROM public.auth_recovery_guards g WHERE g.user_id=u.id AND g.enhanced_required)
    OR EXISTS(SELECT 1 FROM auth_private.factors f WHERE f.user_id=u.id AND f.state='active')
    FROM public."user" u WHERE u.id=uid),true);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_required(text) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.gf_guard_session_access() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_generation integer; current_status text;
BEGIN
  -- Сессия живёт строго 30 дней от входа (D-071): продление не двигает срок дальше.
  IF TG_OP = 'INSERT' THEN
    NEW.expires_at := least(NEW.expires_at, NEW.created_at + interval '30 days');
    SELECT security_generation, status INTO current_generation, current_status
      FROM public."user" WHERE id = NEW.user_id FOR SHARE;
  ELSE
    NEW.expires_at := least(NEW.expires_at, OLD.created_at + interval '30 days');
    -- Строка session уже заблокирована: здесь нет обратной блокировки user.
    IF OLD.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'нельзя продлевать истёкшую сессию' USING ERRCODE = '23514';
    END IF;
    IF (NEW.id, NEW.token, NEW.user_id, NEW.security_generation, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.token, OLD.user_id, OLD.security_generation, OLD.created_at) THEN
      RAISE EXCEPTION 'нельзя менять исходный bearer или принадлежность сессии' USING ERRCODE = '23514';
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
-- Функция чтения принимает исходный bearer, а не доверяет одному session_id.
CREATE FUNCTION public.gf_b_session_access(sid text, bearer text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE s public.session%ROWTYPE; u public."user"%ROWTYPE; p auth_private.proofs%ROWTYPE; required boolean;
BEGIN
  IF bearer IS NULL OR length(bearer) > 256 THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.session WHERE id = sid AND token = bearer;
  IF NOT FOUND OR s.expires_at <= statement_timestamp() THEN RETURN NULL; END IF;
  SELECT * INTO u FROM public."user" WHERE id = s.user_id;
  IF NOT FOUND OR u.status <> 'active' OR u.security_generation <> s.security_generation
     OR u.role NOT IN ('user','developer','admin','owner') THEN RETURN NULL; END IF;
  required := public.gf_b_required(u.id);
  SELECT * INTO p FROM auth_private.proofs WHERE session_id = s.id;
  IF FOUND AND (p.user_id <> u.id OR p.generation <> u.security_generation
     OR p.bearer_hash <> public.gf_b_hash(bearer)) THEN RETURN NULL; END IF;
  IF required AND (p.method IS NULL OR p.method NOT IN ('totp','uv')) THEN RETURN NULL; END IF;
  IF p.method IN ('totp','uv') AND NOT EXISTS(
    SELECT 1 FROM auth_private.factors f WHERE f.id=p.factor_id AND f.user_id=u.id AND f.state='active'
      AND f.kind=p.method AND (f.kind='totp' OR EXISTS(SELECT 1 FROM public.passkey k
        WHERE k.id=f.credential_id AND k.user_id=u.id
          AND f.fingerprint=public.gf_b_hash(jsonb_build_array(k.user_id,k.credential_id,k.public_key)::text)))
  ) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('userId',u.id,'generation',u.security_generation,'required',required,
    'method',p.method,'verifiedAt',p.verified_at,'issuanceId',p.issuance_id);
END;
$$;
--> statement-breakpoint
-- Все писатели B сначала берут access_lock, затем user и лишь затем свои записи.
-- Резервация вызывается отдельным autocommit ДО криптографического verifier.
CREATE FUNCTION public.gf_b_reserve(context_hash text, source_hash text, attempt_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE c auth_private.contexts%ROWTYPE; u public."user"%ROWTYPE;
  domain_name text; counter_keys text[]; budgets integer[]; current_hits jsonb[] := '{}';
  row_hits jsonb; now_ms bigint; i integer; counter_key text; now_at timestamptz;
BEGIN
  IF context_hash IS NULL OR context_hash !~ '^[a-f0-9]{64}$' OR source_hash IS NULL
     OR source_hash !~ '^[a-f0-9]{64}$' OR attempt_id IS NULL OR attempt_id !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
  -- Неизвестный или погасший контекст отсекаем до глобальной блокировки: поток мусорных
  -- cookie не должен вставать в очередь вместе с настоящими входами. Решение - по строке,
  -- перечитанной уже под блокировкой ниже.
  IF NOT EXISTS (SELECT 1 FROM auth_private.contexts WHERE token_hash = context_hash
    AND state = 'active' AND expires_at > clock_timestamp()) THEN RETURN NULL; END IF;
  UPDATE public.access_lock SET id = id WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'не готова блокировка изменений доступа'; END IF;
  SELECT * INTO c FROM auth_private.contexts WHERE token_hash = context_hash;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF c.user_id IS NOT NULL THEN
    SELECT * INTO u FROM public."user" WHERE id = c.user_id FOR UPDATE;
    IF NOT FOUND OR u.status <> 'active' OR u.security_generation <> c.generation THEN RETURN NULL; END IF;
  END IF;
  now_at := clock_timestamp(); now_ms := floor(extract(epoch FROM now_at) * 1000)::bigint;
  IF c.state <> 'active' OR c.expires_at <= now_at OR c.attempts >= 5 OR EXISTS
    (SELECT 1 FROM auth_private.reservations WHERE id = attempt_id) THEN RETURN NULL; END IF;
  domain_name := CASE WHEN c.purpose = 'backup' THEN 'backup' WHEN c.purpose IN ('enrol-cookie','setup') THEN 'enrol' ELSE 'mfa' END;
  -- Анонимный backup не пишет ни userId-квоту MFA, ни парольный LoginGuard.
  counter_keys := ARRAY[domain_name || ':source:' || source_hash]; budgets := ARRAY[20];
  IF c.user_id IS NOT NULL AND c.purpose <> 'backup' THEN
    counter_keys := array_append(counter_keys, domain_name || ':target:' || public.gf_b_hash(c.user_id || ':' || c.purpose));
    budgets := array_append(budgets, 10);
  END IF;
  DELETE FROM auth_private.counters WHERE key IN
    (SELECT key FROM auth_private.counters WHERE domain = domain_name AND expires_at < now_at ORDER BY expires_at LIMIT 100);
  DELETE FROM auth_private.contexts WHERE token_hash IN
    (SELECT token_hash FROM auth_private.contexts WHERE expires_at < now_at - interval '1 day' ORDER BY expires_at LIMIT 100);
  FOR i IN 1..array_length(counter_keys,1) LOOP
    counter_key := counter_keys[i];
    SELECT coalesce(jsonb_agg(value ORDER BY value::bigint),'[]'::jsonb) INTO row_hits
      FROM auth_private.counters, jsonb_array_elements(hits) value
      WHERE key = counter_key AND value::bigint > now_ms - 900000;
    IF jsonb_array_length(row_hits) >= budgets[i] THEN RETURN NULL; END IF;
    IF NOT EXISTS (SELECT 1 FROM auth_private.counters WHERE key = counter_key)
       AND (SELECT count(*) FROM auth_private.counters WHERE domain = domain_name) >= 10000 THEN RETURN NULL; END IF;
    current_hits := array_append(current_hits,row_hits);
  END LOOP;
  FOR i IN 1..array_length(counter_keys,1) LOOP
    INSERT INTO auth_private.counters(key,domain,hits,expires_at)
      VALUES(counter_keys[i],domain_name,current_hits[i] || to_jsonb(now_ms),now_at + interval '15 minutes')
      ON CONFLICT(key) DO UPDATE SET hits = excluded.hits, expires_at = excluded.expires_at;
  END LOOP;
  UPDATE auth_private.contexts SET attempts = attempts + 1 WHERE token_hash = context_hash;
  INSERT INTO auth_private.reservations(id,context_hash,created_at) VALUES(attempt_id,context_hash,now_at);
  RETURN jsonb_build_object('attemptId',attempt_id,'purpose',c.purpose,'userId',c.user_id,'generation',c.generation);
END;
$$;
--> statement-breakpoint
-- Пул auth вызывает эту процедуру лишь после проверки пароля. Сам gf_hub не имеет EXECUTE.
CREATE FUNCTION public.gf_b_password_context(uid text, generation integer, credential_id text, credential_hash text,
  context_hash text, purpose text, sid text, original_bearer text, source_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE u public."user"%ROWTYPE; now_at timestamptz; hits jsonb; key_name text; i integer;
  keys text[]; budgets integer[]; old_hits jsonb[] := '{}';
BEGIN
  IF context_hash IS NULL OR context_hash !~ '^[a-f0-9]{64}$' OR source_hash IS NULL OR source_hash !~ '^[a-f0-9]{64}$'
    OR purpose IS NULL OR purpose NOT IN ('login','reauth','password') THEN RETURN false; END IF;
  UPDATE public.access_lock SET id = id WHERE id = 1;
  SELECT * INTO u FROM public."user" WHERE id = uid FOR UPDATE;
  IF NOT FOUND OR u.status <> 'active' OR u.security_generation <> generation THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.account a WHERE a.id = credential_id AND a.user_id = uid
    AND a.provider_id = 'credential' AND a.password = credential_hash) THEN RETURN false; END IF;
  IF purpose <> 'login' AND public.gf_b_session_access(sid,original_bearer) IS NULL THEN RETURN false; END IF;
  IF purpose <> 'login' AND NOT EXISTS (SELECT 1 FROM public.session WHERE id = sid AND user_id = uid) THEN RETURN false; END IF;
  now_at := clock_timestamp();
  DELETE FROM auth_private.contexts WHERE token_hash IN
    (SELECT token_hash FROM auth_private.contexts WHERE expires_at < now_at - interval '1 day' ORDER BY expires_at LIMIT 100);
  IF (SELECT count(*) FROM auth_private.contexts cx WHERE cx.purpose NOT IN ('backup','uv-login')) >= 10000 THEN RETURN false; END IF;
  keys := ARRAY['issue:target:' || public.gf_b_hash(uid || ':' || purpose), 'issue:source:' || source_hash];
  budgets := ARRAY[5,20];
  FOR i IN 1..2 LOOP
    key_name := keys[i];
    SELECT coalesce(jsonb_agg(value),'[]'::jsonb) INTO hits
      FROM auth_private.counters ctr,jsonb_array_elements(ctr.hits) value
      WHERE ctr.key = key_name AND value::bigint > floor(extract(epoch FROM now_at)*1000)::bigint - 900000;
    IF jsonb_array_length(hits) >= budgets[i] THEN RETURN false; END IF;
    IF NOT EXISTS (SELECT 1 FROM auth_private.counters WHERE key = key_name)
      AND (SELECT count(*) FROM auth_private.counters WHERE domain = 'issue') >= 9999 THEN RETURN false; END IF;
    old_hits := array_append(old_hits,hits);
  END LOOP;
  FOR i IN 1..2 LOOP
    INSERT INTO auth_private.counters(key,domain,hits,expires_at)
      VALUES(keys[i],'issue',old_hits[i] || to_jsonb(floor(extract(epoch FROM now_at)*1000)::bigint),now_at + interval '15 minutes')
      ON CONFLICT(key) DO UPDATE SET hits = excluded.hits, expires_at = excluded.expires_at;
  END LOOP;
  INSERT INTO auth_private.contexts(token_hash,user_id,generation,purpose,credential_id,credential_hash,session_id,session_bearer_hash,created_at,expires_at)
    VALUES(context_hash,uid,generation,purpose,credential_id,credential_hash,sid,public.gf_b_hash(original_bearer),now_at,now_at + interval '5 minutes');
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.gf_b_totp_login(context_hash text, attempt_id text, factor_id text, factor_ciphertext text,
  accepted_step bigint, new_id text, new_token text, issuance_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE c auth_private.contexts%ROWTYPE; u public."user"%ROWTYPE; f auth_private.factors%ROWTYPE;
  now_at timestamptz; s public.session%ROWTYPE;
BEGIN
  UPDATE public.access_lock SET id = id WHERE id = 1;
  SELECT * INTO c FROM auth_private.contexts WHERE token_hash = context_hash;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO u FROM public."user" WHERE id = c.user_id FOR UPDATE;
  now_at := clock_timestamp();
  IF NOT FOUND OR u.status <> 'active' OR u.security_generation <> c.generation OR c.state <> 'active'
    OR c.purpose NOT IN ('login','reauth') OR c.expires_at <= now_at THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.account a WHERE a.id = c.credential_id AND a.user_id = u.id
    AND a.provider_id = 'credential' AND a.password = c.credential_hash) THEN RETURN NULL; END IF;
  SELECT * INTO f FROM auth_private.factors WHERE id = factor_id AND user_id = u.id FOR UPDATE;
  IF NOT FOUND OR f.kind <> 'totp' OR f.state <> 'active' OR f.ciphertext <> factor_ciphertext
    OR accepted_step IS NULL OR accepted_step <= f.last_step
    OR abs(accepted_step - floor(extract(epoch FROM now_at)/30)::bigint) > 1 THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth_private.reservations r WHERE r.id = attempt_id AND r.context_hash = c.token_hash AND r.finished_at IS NULL) THEN RETURN NULL; END IF;
  IF c.purpose = 'reauth' AND NOT EXISTS(SELECT 1 FROM public.session original WHERE original.id = c.session_id AND original.user_id = u.id
    AND original.security_generation = c.generation AND original.expires_at > now_at AND public.gf_b_hash(original.token) = c.session_bearer_hash) THEN RETURN NULL; END IF;
  IF new_id IS NULL OR new_token IS NULL OR issuance_id IS NULL OR length(new_token) < 32 THEN RETURN NULL; END IF;
  UPDATE auth_private.factors SET last_step = accepted_step WHERE id = f.id;
  UPDATE auth_private.contexts SET state = 'spent' WHERE token_hash = c.token_hash;
  UPDATE auth_private.reservations SET finished_at = now_at WHERE id = attempt_id;
  IF c.purpose = 'reauth' THEN DELETE FROM public.session WHERE id = c.session_id; END IF;
  INSERT INTO public.session(id,token,user_id,security_generation,created_at,updated_at,expires_at)
    VALUES(new_id,new_token,u.id,u.security_generation,now_at,now_at,now_at + interval '30 days') RETURNING * INTO s;
  INSERT INTO auth_private.proofs(session_id,user_id,generation,bearer_hash,issuance_id,method,factor_id,verified_at)
    VALUES(s.id,u.id,u.security_generation,public.gf_b_hash(s.token),issuance_id,'totp',f.id,now_at);
  RETURN to_jsonb(s);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_hash(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_session_access(text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_reserve(text,text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_password_context(text,integer,text,text,text,text,text,text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_totp_login(text,text,text,text,bigint,text,text,text) FROM PUBLIC;

--> statement-breakpoint
-- Чтение ciphertext и исходного credential разрешено только доверенному auth-пулу.
CREATE FUNCTION public.gf_b_snapshot(email_address text, context_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE u public."user"%ROWTYPE; c auth_private.contexts%ROWTYPE; a public.account%ROWTYPE; f auth_private.factors%ROWTYPE;
BEGIN
  IF context_hash IS NOT NULL THEN
    SELECT * INTO c FROM auth_private.contexts WHERE token_hash = context_hash AND state='active' AND expires_at > statement_timestamp();
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO u FROM public."user" WHERE id = c.user_id;
    IF NOT FOUND OR u.security_generation <> c.generation THEN RETURN NULL; END IF;
  ELSE
    SELECT * INTO u FROM public."user" WHERE email = email_address;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;
  IF u.status <> 'active' OR u.role NOT IN ('user','developer','admin','owner') THEN RETURN NULL; END IF;
  SELECT * INTO a FROM public.account WHERE user_id = u.id AND provider_id = 'credential' ORDER BY id LIMIT 1;
  SELECT * INTO f FROM auth_private.factors WHERE user_id = u.id AND kind = 'totp'
    AND ((c.purpose IN ('enrol-cookie','setup') AND state = 'pending' AND id = c.data->>'factorId')
      OR (coalesce(c.purpose,'login') IN ('login','reauth','password') AND state = 'active')) ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object('user',to_jsonb(u),'account',to_jsonb(a),'context',CASE WHEN c.token_hash IS NULL THEN NULL ELSE to_jsonb(c) END,
    'factor',CASE WHEN f.id IS NULL THEN NULL ELSE to_jsonb(f) END,
    'required',public.gf_b_required(u.id));
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.gf_b_password_login(context_hash text, new_id text, new_token text, issuance_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE c auth_private.contexts%ROWTYPE; u public."user"%ROWTYPE; s public.session%ROWTYPE; now_at timestamptz;
BEGIN
  UPDATE public.access_lock SET id=id WHERE id=1;
  SELECT * INTO c FROM auth_private.contexts WHERE token_hash=context_hash;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO u FROM public."user" WHERE id=c.user_id FOR UPDATE;
  now_at:=clock_timestamp();
  IF NOT FOUND OR u.status<>'active' OR u.security_generation<>c.generation OR public.gf_b_required(u.id)
    OR c.state<>'active' OR c.purpose NOT IN ('login','password') OR c.expires_at<=now_at THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.account a WHERE a.id=c.credential_id AND a.user_id=u.id AND a.password=c.credential_hash AND a.provider_id='credential') THEN RETURN NULL; END IF;
  IF c.purpose='password' AND NOT EXISTS(SELECT 1 FROM public.session original WHERE original.id=c.session_id
    AND original.user_id=u.id AND public.gf_b_hash(original.token)=c.session_bearer_hash AND original.expires_at>now_at) THEN RETURN NULL; END IF;
  IF new_id IS NULL OR new_token IS NULL OR issuance_id IS NULL OR length(new_token)<32 THEN RETURN NULL; END IF;
  UPDATE auth_private.contexts SET state='spent' WHERE token_hash=c.token_hash;
  IF c.purpose='password' THEN DELETE FROM public.session WHERE id=c.session_id; END IF;
  INSERT INTO public.session(id,token,user_id,security_generation,created_at,updated_at,expires_at)
    VALUES(new_id,new_token,u.id,u.security_generation,now_at,now_at,now_at+interval '30 days') RETURNING * INTO s;
  INSERT INTO auth_private.proofs(session_id,user_id,generation,bearer_hash,issuance_id,method,verified_at)
    VALUES(s.id,u.id,u.security_generation,public.gf_b_hash(s.token),issuance_id,'password',now_at);
  RETURN to_jsonb(s);
END;
$$;
--> statement-breakpoint
-- Общая короткая свежесть: caller не назначает метод/verifiedAt.
CREATE FUNCTION public.gf_b_fresh(sid text, bearer text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE value jsonb;
BEGIN
  value:=public.gf_b_session_access(sid,bearer);
  IF value IS NULL OR value->>'verifiedAt' IS NULL
    OR (value->>'verifiedAt')::timestamptz <= statement_timestamp()-interval '5 minutes'
    OR (value->>'verifiedAt')::timestamptz > statement_timestamp() THEN RETURN NULL; END IF;
  RETURN value;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.gf_b_setup(sid text, bearer text, context_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE access jsonb; u public."user"%ROWTYPE; now_at timestamptz;
BEGIN
  UPDATE public.access_lock SET id=id WHERE id=1;
  SELECT u0.* INTO u FROM public."user" u0 JOIN public.session s ON s.user_id=u0.id WHERE s.id=sid FOR UPDATE OF u0;
  IF NOT FOUND THEN RETURN false; END IF;
  access:=public.gf_b_fresh(sid,bearer);now_at:=clock_timestamp();
  IF access IS NULL OR context_hash IS NULL OR context_hash!~'^[a-f0-9]{64}$'
    OR (SELECT count(*) FROM auth_private.contexts WHERE purpose NOT IN ('backup','uv-login'))>=10000 THEN RETURN false; END IF;
  UPDATE auth_private.contexts SET state='spent' WHERE user_id=u.id AND purpose='setup';
  INSERT INTO auth_private.contexts(token_hash,user_id,generation,purpose,session_id,session_bearer_hash,created_at,expires_at)
    VALUES(context_hash,u.id,u.security_generation,'setup',sid,public.gf_b_hash(bearer),now_at,now_at+interval '5 minutes');
  RETURN true;
END;
$$;
--> statement-breakpoint
-- Операторская процедура не выдаётся роли gf_auth. Требуется подключение владельца БД.
CREATE FUNCTION public.gf_b_operator_enrol(uid text, password_hash text, context_hash text, reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE u public."user"%ROWTYPE; now_at timestamptz;
BEGIN
  IF context_hash IS NULL OR context_hash!~'^[a-f0-9]{64}$' OR password_hash IS NULL
    OR password_hash!~'^[a-f0-9]{32}:[a-f0-9]{128}$' OR reason IS NULL OR length(trim(reason)) NOT BETWEEN 1 AND 1000
    OR reason~'[[:cntrl:]]' THEN RETURN false; END IF;
  UPDATE public.access_lock SET id=id WHERE id=1;
  SELECT * INTO u FROM public."user" WHERE id=uid FOR UPDATE;
  IF NOT FOUND OR u.status<>'active' OR (SELECT count(*) FROM auth_private.contexts WHERE purpose NOT IN ('backup','uv-login'))>=10000 THEN RETURN false; END IF;
  now_at:=clock_timestamp();
  UPDATE public.account SET password=password_hash,updated_at=now_at WHERE user_id=uid AND provider_id='credential';
  IF NOT FOUND THEN RETURN false; END IF;
  DELETE FROM auth_private.factors WHERE user_id=uid;
  DELETE FROM auth_private.backup_codes WHERE user_id=uid;
  DELETE FROM public.passkey WHERE user_id=uid;
  DELETE FROM public.session WHERE user_id=uid;
  UPDATE auth_private.contexts SET state='spent' WHERE user_id=uid;
  INSERT INTO public.auth_recovery_guards(user_id,enhanced_required) VALUES(uid,true)
    ON CONFLICT(user_id) DO UPDATE SET enhanced_required=true;
  PERFORM set_config('gf.access_actor_kind','operator',true),set_config('gf.access_actor_id','',true),set_config('gf.access_reason',trim(reason),true);
  UPDATE public."user" SET security_generation=security_generation+1,updated_at=now_at WHERE id=uid RETURNING * INTO u;
  INSERT INTO auth_private.contexts(token_hash,user_id,generation,purpose,created_at,expires_at)
    VALUES(context_hash,uid,u.security_generation,'enrol-token',now_at,now_at+interval '5 minutes');
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.gf_b_exchange_enrol(original_hash text, cookie_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE c auth_private.contexts%ROWTYPE; u public."user"%ROWTYPE; now_at timestamptz;
BEGIN
  IF cookie_hash IS NULL OR cookie_hash!~'^[a-f0-9]{64}$' OR original_hash=cookie_hash THEN RETURN false; END IF;
  -- Как в gf_b_reserve: случайный token не доходит до глобальной блокировки.
  IF NOT EXISTS(SELECT 1 FROM auth_private.contexts WHERE token_hash=original_hash
    AND state='active' AND expires_at>clock_timestamp()) THEN RETURN false; END IF;
  UPDATE public.access_lock SET id=id WHERE id=1;
  SELECT * INTO c FROM auth_private.contexts WHERE token_hash=original_hash;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO u FROM public."user" WHERE id=c.user_id FOR UPDATE;
  now_at:=clock_timestamp();
  IF NOT FOUND OR u.status<>'active' OR u.security_generation<>c.generation OR c.state<>'active'
    OR c.purpose<>'enrol-token' OR c.expires_at<=now_at THEN RETURN false; END IF;
  UPDATE auth_private.contexts SET state='spent' WHERE token_hash=c.token_hash;
  -- data несёт метку recovery дальше: по ней totp_complete отзывает прежние факторы.
  INSERT INTO auth_private.contexts(token_hash,user_id,generation,purpose,data,created_at,expires_at)
    VALUES(cookie_hash,u.id,u.security_generation,'enrol-cookie',c.data,now_at,c.expires_at);
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.gf_b_totp_pending(context_hash text, factor_id text, key_id text, ciphertext text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE c auth_private.contexts%ROWTYPE; u public."user"%ROWTYPE; now_at timestamptz;
BEGIN
  UPDATE public.access_lock SET id=id WHERE id=1;
  SELECT * INTO c FROM auth_private.contexts WHERE token_hash=context_hash;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO u FROM public."user" WHERE id=c.user_id FOR UPDATE;
  now_at:=clock_timestamp();
  IF NOT FOUND OR u.status<>'active' OR u.security_generation<>c.generation OR c.state<>'active'
    OR c.purpose NOT IN ('setup','enrol-cookie') OR c.expires_at<=now_at OR c.data?'factorId'
    OR factor_id IS NULL OR key_id IS NULL OR ciphertext IS NULL OR length(ciphertext)>256 THEN RETURN false; END IF;
  IF c.purpose='setup' AND NOT EXISTS(SELECT 1 FROM public.session original WHERE original.id=c.session_id
    AND original.user_id=u.id AND public.gf_b_hash(original.token)=c.session_bearer_hash
    AND public.gf_b_fresh(original.id,original.token) IS NOT NULL) THEN RETURN false; END IF;
  DELETE FROM auth_private.factors WHERE user_id=u.id AND kind='totp' AND state='pending';
  INSERT INTO auth_private.factors(id,user_id,kind,state,key_id,ciphertext,created_at,expires_at)
    VALUES(factor_id,u.id,'totp','pending',key_id,ciphertext,now_at,now_at+interval '10 minutes');
  UPDATE auth_private.contexts SET data=c.data||jsonb_build_object('factorId',factor_id) WHERE token_hash=c.token_hash;
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.gf_b_totp_complete(context_hash text, attempt_id text, factor_id text, original_ciphertext text,
  accepted_step bigint, code_hashes text[], set_id text, password_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE c auth_private.contexts%ROWTYPE; u public."user"%ROWTYPE; f auth_private.factors%ROWTYPE; now_at timestamptz;
BEGIN
  IF code_hashes IS NULL OR cardinality(code_hashes)<>10 OR cardinality(ARRAY(SELECT DISTINCT unnest(code_hashes)))<>10
    OR EXISTS(SELECT 1 FROM unnest(code_hashes) h WHERE h IS NULL OR h!~'^[a-f0-9]{64}$') OR set_id IS NULL THEN RETURN false; END IF;
  IF password_hash IS NOT NULL AND password_hash!~'^[a-f0-9]{32}:[a-f0-9]{128}$' THEN RETURN false; END IF;
  UPDATE public.access_lock SET id=id WHERE id=1;
  SELECT * INTO c FROM auth_private.contexts WHERE token_hash=context_hash;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO u FROM public."user" WHERE id=c.user_id FOR UPDATE;
  now_at:=clock_timestamp();
  IF NOT FOUND OR u.status<>'active' OR u.security_generation<>c.generation OR c.state<>'active'
    OR c.purpose NOT IN ('setup','enrol-cookie') OR c.expires_at<=now_at OR c.data->>'factorId' IS DISTINCT FROM factor_id THEN RETURN false; END IF;
  -- Новый пароль - только в enrolment после exchange/recover; setup меняет пароль лишь через password-change.
  IF password_hash IS NOT NULL AND c.purpose<>'enrol-cookie' THEN RETURN false; END IF;
  -- Восстановление по backup-коду - только с новым паролем: прежний мог утечь (решение владельца 2026-11-23).
  IF c.data ? 'recovery' AND password_hash IS NULL THEN RETURN false; END IF;
  SELECT * INTO f FROM auth_private.factors WHERE id=factor_id AND user_id=u.id FOR UPDATE;
  IF NOT FOUND OR f.kind<>'totp' OR f.state<>'pending' OR f.expires_at<=now_at
    OR f.ciphertext IS DISTINCT FROM original_ciphertext OR accepted_step IS NULL OR accepted_step<=f.last_step
    OR abs(accepted_step-floor(extract(epoch FROM now_at)/30)::bigint)>1 THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth_private.reservations r WHERE r.id=attempt_id AND r.context_hash=c.token_hash AND r.finished_at IS NULL) THEN RETURN false; END IF;
  IF c.purpose='setup' AND NOT EXISTS(SELECT 1 FROM public.session original WHERE original.id=c.session_id AND original.user_id=u.id
    AND public.gf_b_hash(original.token)=c.session_bearer_hash AND public.gf_b_fresh(original.id,original.token) IS NOT NULL) THEN RETURN false; END IF;
  IF password_hash IS NOT NULL THEN
    UPDATE public.account SET password=password_hash,updated_at=now_at WHERE user_id=u.id AND provider_id='credential';
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;
  -- TOTP без действующего пароля не даёт достижимого способа входа.
  IF NOT EXISTS(SELECT 1 FROM public.account WHERE user_id=u.id AND provider_id='credential' AND password IS NOT NULL) THEN RETURN false; END IF;
  DELETE FROM auth_private.factors WHERE user_id=u.id AND kind='totp' AND id<>f.id;
  -- Восстановление по backup-коду отзывает прежнее только сейчас, когда новый фактор готов:
  -- брошенное на полпути восстановление не оставляет учётку без входа.
  IF c.data ? 'recovery' THEN
    DELETE FROM auth_private.factors WHERE user_id=u.id AND id<>f.id;
    DELETE FROM public.passkey WHERE user_id=u.id;
    DELETE FROM public.session WHERE user_id=u.id;
  END IF;
  UPDATE auth_private.factors SET state='active',last_step=accepted_step,expires_at=NULL WHERE id=f.id;
  DELETE FROM auth_private.backup_codes WHERE user_id=u.id;
  INSERT INTO auth_private.backup_codes(code_hash,user_id,set_id,created_at) SELECT h,u.id,set_id,now_at FROM unnest(code_hashes) h;
  INSERT INTO public.auth_recovery_guards(user_id,enhanced_required) VALUES(u.id,true)
    ON CONFLICT(user_id) DO UPDATE SET enhanced_required=true;
  UPDATE auth_private.contexts SET state='spent' WHERE user_id=u.id;
  UPDATE auth_private.reservations SET finished_at=now_at WHERE id=attempt_id;
  UPDATE public."user" SET security_generation=security_generation+1,updated_at=now_at WHERE id=u.id;
  RETURN true;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_snapshot(text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_password_login(text,text,text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_fresh(text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_setup(text,text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_operator_enrol(text,text,text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_exchange_enrol(text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_totp_pending(text,text,text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_totp_complete(text,text,text,text,bigint,text[],text,text) FROM PUBLIC;

--> statement-breakpoint
CREATE FUNCTION public.gf_b_backup_context(context_hash text, source_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE key_name text; row_hits jsonb; now_at timestamptz; now_ms bigint;
BEGIN
  IF context_hash IS NULL OR source_hash IS NULL OR context_hash!~'^[a-f0-9]{64}$' OR source_hash!~'^[a-f0-9]{64}$' THEN RETURN false; END IF;
  -- Исчерпанный бюджет источника отсекаем до глобальной блокировки; решение - снова под ней.
  IF (SELECT count(*) FROM auth_private.counters ctr,jsonb_array_elements(ctr.hits) value WHERE ctr.key='backup:issue:'||source_hash
    AND value::bigint>floor(extract(epoch FROM clock_timestamp())*1000)::bigint-900000)>=20 THEN RETURN false; END IF;
  UPDATE public.access_lock SET id=id WHERE id=1;
  now_at:=clock_timestamp();now_ms:=floor(extract(epoch FROM now_at)*1000)::bigint;
  DELETE FROM auth_private.contexts WHERE token_hash IN
    (SELECT token_hash FROM auth_private.contexts WHERE purpose='backup' AND expires_at<now_at-interval '1 day' ORDER BY expires_at LIMIT 100);
  DELETE FROM auth_private.counters WHERE key IN
    (SELECT key FROM auth_private.counters WHERE domain='backup' AND expires_at<now_at ORDER BY expires_at LIMIT 100);
  -- Потолок - по живым контекстам: истёкшие лежат до суток и не должны держать восстановление закрытым.
  IF (SELECT count(*) FROM auth_private.contexts WHERE purpose='backup' AND expires_at>now_at)>=10000 THEN RETURN false; END IF;
  key_name:='backup:issue:'||source_hash;
  SELECT coalesce(jsonb_agg(value),'[]'::jsonb) INTO row_hits
    FROM auth_private.counters ctr,jsonb_array_elements(ctr.hits) value
    WHERE ctr.key=key_name AND value::bigint>now_ms-900000;
  IF jsonb_array_length(row_hits)>=20 OR (NOT EXISTS(SELECT 1 FROM auth_private.counters WHERE key=key_name)
    AND (SELECT count(*) FROM auth_private.counters WHERE domain='backup')>=10000) THEN RETURN false; END IF;
  INSERT INTO auth_private.counters(key,domain,hits,expires_at) VALUES(key_name,'backup',row_hits||to_jsonb(now_ms),now_at+interval '15 minutes')
    ON CONFLICT(key) DO UPDATE SET hits=excluded.hits,expires_at=excluded.expires_at;
  INSERT INTO auth_private.contexts(token_hash,purpose,created_at,expires_at)
    VALUES(context_hash,'backup',now_at,now_at+interval '5 minutes');
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.gf_b_backup_recover(context_hash text, attempt_id text, uid text, code_hash text, enrol_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE c auth_private.contexts%ROWTYPE; u public."user"%ROWTYPE; now_at timestamptz;
BEGIN
  IF enrol_hash IS NULL OR enrol_hash!~'^[a-f0-9]{64}$' THEN RETURN false; END IF;
  UPDATE public.access_lock SET id=id WHERE id=1;
  SELECT * INTO u FROM public."user" WHERE id=uid FOR UPDATE;
  now_at:=clock_timestamp();
  IF NOT FOUND OR u.status<>'active' OR (SELECT count(*) FROM auth_private.contexts WHERE purpose NOT IN ('backup','uv-login'))>=10000 THEN RETURN false; END IF;
  SELECT * INTO c FROM auth_private.contexts WHERE token_hash=context_hash;
  IF NOT FOUND OR c.purpose<>'backup' OR c.state<>'active' OR c.expires_at<=now_at THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth_private.reservations r WHERE r.id=attempt_id AND r.context_hash=c.token_hash AND r.finished_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM auth_private.backup_codes b WHERE b.code_hash=gf_b_backup_recover.code_hash AND b.user_id=u.id) THEN RETURN false; END IF;
  -- Здесь ничего не сжигаем (решение владельца 2026-11-23): пароль, факторы, passkey, сессии и
  -- остальные коды живут, пока новый фактор не включён в gf_b_totp_complete - он и отзывает
  -- прежнее. Брошенное восстановление не запирает учётку. Новое восстановление заменяет
  -- незавершённое прежнее: активным остаётся максимум одно.
  UPDATE auth_private.contexts SET state='spent' WHERE token_hash=c.token_hash OR (user_id=u.id AND data ? 'recovery');
  UPDATE auth_private.reservations SET finished_at=now_at WHERE id=attempt_id;
  INSERT INTO auth_private.contexts(token_hash,user_id,generation,purpose,data,created_at,expires_at)
    VALUES(enrol_hash,u.id,u.security_generation,'enrol-token','{"recovery":true}'::jsonb,now_at,now_at+interval '5 minutes');
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.gf_b_password_change(sid text, bearer text, credential_id text, original_hash text, new_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE u public."user"%ROWTYPE; access jsonb; now_at timestamptz;
BEGIN
  IF new_hash IS NULL OR new_hash!~'^[a-f0-9]{32}:[a-f0-9]{128}$' THEN RETURN false; END IF;
  UPDATE public.access_lock SET id=id WHERE id=1;
  SELECT u0.* INTO u FROM public."user" u0 JOIN public.session s ON s.user_id=u0.id WHERE s.id=sid FOR UPDATE OF u0;
  IF NOT FOUND THEN RETURN false; END IF;
  access:=public.gf_b_fresh(sid,bearer);now_at:=clock_timestamp();
  IF access IS NULL THEN RETURN false; END IF;
  UPDATE public.account SET password=new_hash,updated_at=now_at WHERE id=credential_id AND user_id=u.id
    AND provider_id='credential' AND password=original_hash;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE auth_private.contexts SET state='spent' WHERE user_id=u.id;
  UPDATE public."user" SET security_generation=security_generation+1,updated_at=now_at WHERE id=u.id;
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.gf_b_backup_rotate(sid text, bearer text, code_hashes text[], set_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE u public."user"%ROWTYPE; access jsonb; now_at timestamptz;
BEGIN
  IF code_hashes IS NULL OR cardinality(code_hashes)<>10 OR cardinality(ARRAY(SELECT DISTINCT unnest(code_hashes)))<>10
    OR EXISTS(SELECT 1 FROM unnest(code_hashes) h WHERE h IS NULL OR h!~'^[a-f0-9]{64}$') OR set_id IS NULL THEN RETURN false; END IF;
  UPDATE public.access_lock SET id=id WHERE id=1;
  SELECT u0.* INTO u FROM public."user" u0 JOIN public.session s ON s.user_id=u0.id WHERE s.id=sid FOR UPDATE OF u0;
  IF NOT FOUND THEN RETURN false; END IF;
  access:=public.gf_b_fresh(sid,bearer);now_at:=clock_timestamp();
  IF access IS NULL OR NOT EXISTS(SELECT 1 FROM auth_private.factors WHERE user_id=u.id AND state='active') THEN RETURN false; END IF;
  DELETE FROM auth_private.backup_codes WHERE user_id=u.id;
  INSERT INTO auth_private.backup_codes(code_hash,user_id,set_id,created_at) SELECT h,u.id,set_id,now_at FROM unnest(code_hashes) h;
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.gf_b_disable_optional(sid text, bearer text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE u public."user"%ROWTYPE; access jsonb; now_at timestamptz;
BEGIN
  UPDATE public.access_lock SET id=id WHERE id=1;
  SELECT u0.* INTO u FROM public."user" u0 JOIN public.session s ON s.user_id=u0.id WHERE s.id=sid FOR UPDATE OF u0;
  IF NOT FOUND OR u.role NOT IN ('user','developer') THEN RETURN false; END IF;
  access:=public.gf_b_fresh(sid,bearer);now_at:=clock_timestamp();
  IF access IS NULL OR access->>'method' NOT IN ('totp','uv') THEN RETURN false; END IF;
  DELETE FROM auth_private.factors WHERE user_id=u.id;
  DELETE FROM auth_private.backup_codes WHERE user_id=u.id;
  DELETE FROM public.auth_recovery_guards WHERE user_id=u.id;
  UPDATE auth_private.contexts SET state='spent' WHERE user_id=u.id;
  UPDATE public."user" SET security_generation=security_generation+1,updated_at=now_at WHERE id=u.id;
  RETURN true;
END;
$$;
--> statement-breakpoint
-- Анонимный одноразовый контекст входа по UV: выдаётся до WebAuthn-церемонии, гасится в
-- gf_b_uv_finish. Свой домен счётчиков и свой потолок - не съедает квоты MFA и backup.
CREATE FUNCTION public.gf_b_uv_login_context(context_hash text, source_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE key_name text; row_hits jsonb; now_at timestamptz; now_ms bigint;
BEGIN
  IF context_hash IS NULL OR source_hash IS NULL OR context_hash!~'^[a-f0-9]{64}$' OR source_hash!~'^[a-f0-9]{64}$' THEN RETURN false; END IF;
  -- Как в gf_b_backup_context: исчерпанный бюджет источника - отказ до глобальной блокировки.
  IF (SELECT count(*) FROM auth_private.counters ctr,jsonb_array_elements(ctr.hits) value WHERE ctr.key='uv:issue:'||source_hash
    AND value::bigint>floor(extract(epoch FROM clock_timestamp())*1000)::bigint-900000)>=20 THEN RETURN false; END IF;
  UPDATE public.access_lock SET id=id WHERE id=1;
  now_at:=clock_timestamp();now_ms:=floor(extract(epoch FROM now_at)*1000)::bigint;
  DELETE FROM auth_private.contexts WHERE token_hash IN
    (SELECT token_hash FROM auth_private.contexts WHERE purpose='uv-login' AND expires_at<now_at-interval '1 day' ORDER BY expires_at LIMIT 100);
  DELETE FROM auth_private.counters WHERE key IN
    (SELECT key FROM auth_private.counters WHERE domain='uv' AND expires_at<now_at ORDER BY expires_at LIMIT 100);
  IF (SELECT count(*) FROM auth_private.contexts WHERE purpose='uv-login' AND expires_at>now_at)>=10000 THEN RETURN false; END IF;
  key_name:='uv:issue:'||source_hash;
  SELECT coalesce(jsonb_agg(value),'[]'::jsonb) INTO row_hits
    FROM auth_private.counters ctr,jsonb_array_elements(ctr.hits) value
    WHERE ctr.key=key_name AND value::bigint>now_ms-900000;
  IF jsonb_array_length(row_hits)>=20 OR (NOT EXISTS(SELECT 1 FROM auth_private.counters WHERE key=key_name)
    AND (SELECT count(*) FROM auth_private.counters WHERE domain='uv')>=10000) THEN RETURN false; END IF;
  INSERT INTO auth_private.counters(key,domain,hits,expires_at) VALUES(key_name,'uv',row_hits||to_jsonb(now_ms),now_at+interval '15 minutes')
    ON CONFLICT(key) DO UPDATE SET hits=excluded.hits,expires_at=excluded.expires_at;
  INSERT INTO auth_private.contexts(token_hash,purpose,created_at,expires_at)
    VALUES(context_hash,'uv-login',now_at,now_at+interval '5 minutes');
  RETURN true;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_uv_login_context(text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_backup_context(text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_backup_recover(text,text,text,text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_password_change(text,text,text,text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_backup_rotate(text,text,text[],text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_disable_optional(text,text) FROM PUBLIC;

--> statement-breakpoint
CREATE FUNCTION public.gf_b_uv_snapshot(external_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE k public.passkey%ROWTYPE; u public."user"%ROWTYPE; f auth_private.factors%ROWTYPE; fp text;
BEGIN
  SELECT * INTO k FROM public.passkey WHERE credential_id=external_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO u FROM public."user" WHERE id=k.user_id;
  IF NOT FOUND OR u.status<>'active' THEN RETURN NULL; END IF;
  fp:=public.gf_b_hash(jsonb_build_array(k.user_id,k.credential_id,k.public_key)::text);
  SELECT * INTO f FROM auth_private.factors WHERE credential_id=k.id AND user_id=u.id AND kind='uv' AND fingerprint=fp;
  RETURN jsonb_build_object('userId',u.id,'generation',u.security_generation,'key',to_jsonb(k),'fingerprint',fp,
    'factorId',f.id,'state',f.state,'required',public.gf_b_required(u.id));
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.gf_b_enrol_key(context_hash text, key_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE c auth_private.contexts%ROWTYPE; u public."user"%ROWTYPE; k public.passkey%ROWTYPE; now_at timestamptz;
BEGIN
  UPDATE public.access_lock SET id=id WHERE id=1;
  SELECT * INTO c FROM auth_private.contexts WHERE token_hash=context_hash;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO u FROM public."user" WHERE id=c.user_id FOR UPDATE;
  now_at:=clock_timestamp();
  IF NOT FOUND OR u.status<>'active' OR u.security_generation<>c.generation OR c.state<>'active'
    OR c.purpose NOT IN ('setup','enrol-cookie') OR c.expires_at<=now_at OR c.data?'uvKeyId' THEN RETURN NULL; END IF;
  -- При восстановлении ключ не заводим вовсе: ожидающий passkey держателя кода лёг бы в public.passkey,
  -- а завершить восстановление можно только через TOTP с новым паролем.
  IF c.data ? 'recovery' THEN RETURN NULL; END IF;
  IF c.purpose='setup' AND NOT EXISTS(SELECT 1 FROM public.session original WHERE original.id=c.session_id
    AND original.user_id=u.id AND public.gf_b_hash(original.token)=c.session_bearer_hash
    AND public.gf_b_fresh(original.id,original.token) IS NOT NULL) THEN RETURN NULL; END IF;
  IF key_data->>'userId' IS DISTINCT FROM u.id OR key_data->>'id' IS NULL OR key_data->>'publicKey' IS NULL
    OR key_data->>'credentialID' IS NULL OR length(key_data->>'publicKey')>8192
    OR length(key_data->>'credentialID')>2048 THEN RETURN NULL; END IF;
  INSERT INTO public.passkey(id,user_id,name,public_key,credential_id,counter,device_type,backed_up,transports,created_at,aaguid)
    VALUES(key_data->>'id',u.id,left(key_data->>'name',128),key_data->>'publicKey',key_data->>'credentialID',
      (key_data->>'counter')::integer,key_data->>'deviceType',(key_data->>'backedUp')::boolean,key_data->>'transports',now_at,key_data->>'aaguid') RETURNING * INTO k;
  INSERT INTO auth_private.factors(id,user_id,kind,state,credential_id,fingerprint,created_at,expires_at)
    VALUES(k.id,u.id,'uv','pending',k.id,public.gf_b_hash(jsonb_build_array(k.user_id,k.credential_id,k.public_key)::text),now_at,c.expires_at);
  UPDATE auth_private.contexts SET data=data||jsonb_build_object('uvKeyId',k.id) WHERE token_hash=c.token_hash;
  RETURN to_jsonb(k);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.gf_b_uv_context(sid text, bearer text, context_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE access jsonb; u public."user"%ROWTYPE; now_at timestamptz;
BEGIN
  UPDATE public.access_lock SET id=id WHERE id=1;
  SELECT u0.* INTO u FROM public."user" u0 JOIN public.session s ON s.user_id=u0.id WHERE s.id=sid FOR UPDATE OF u0;
  IF NOT FOUND THEN RETURN false; END IF;
  access:=public.gf_b_session_access(sid,bearer);now_at:=clock_timestamp();
  IF access IS NULL OR context_hash IS NULL OR context_hash!~'^[a-f0-9]{64}$'
    OR (SELECT count(*) FROM auth_private.contexts WHERE purpose NOT IN ('backup','uv-login'))>=10000 THEN RETURN false; END IF;
  INSERT INTO auth_private.contexts(token_hash,user_id,generation,purpose,session_id,session_bearer_hash,created_at,expires_at)
    VALUES(context_hash,u.id,u.security_generation,'reauth',sid,public.gf_b_hash(bearer),now_at,now_at+interval '5 minutes');
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.gf_b_uv_finish(uid text, generation integer, key_id text, fingerprint text, new_counter integer,
  context_hash text, new_id text, new_token text, issuance_id text, code_hashes text[], set_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE u public."user"%ROWTYPE; k public.passkey%ROWTYPE; f auth_private.factors%ROWTYPE; c auth_private.contexts%ROWTYPE;
  now_at timestamptz; s public.session%ROWTYPE; fp text;
BEGIN
  UPDATE public.access_lock SET id=id WHERE id=1;
  SELECT * INTO u FROM public."user" WHERE id=uid FOR UPDATE;
  IF NOT FOUND OR u.status<>'active' OR u.security_generation<>generation THEN RETURN NULL; END IF;
  now_at:=clock_timestamp();
  SELECT * INTO k FROM public.passkey WHERE id=key_id AND user_id=u.id FOR UPDATE;
  IF NOT FOUND OR new_counter IS NULL OR k.counter<>new_counter THEN RETURN NULL; END IF;
  fp:=public.gf_b_hash(jsonb_build_array(k.user_id,k.credential_id,k.public_key)::text);
  SELECT fx.* INTO f FROM auth_private.factors fx WHERE fx.credential_id=k.id AND fx.user_id=u.id AND fx.kind='uv' AND fx.fingerprint=fp FOR UPDATE;
  IF NOT FOUND OR fp IS DISTINCT FROM fingerprint THEN RETURN NULL; END IF;
  -- Без серверного контекста UV ничего не выдаёт: повтор того же снимка (двойная отправка,
  -- ретрай) не становится второй сессией. Вход - одноразовым анонимным контекстом 'uv-login'.
  IF context_hash IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO c FROM auth_private.contexts WHERE token_hash=context_hash;
  IF NOT FOUND OR c.state<>'active' OR c.expires_at<=now_at THEN RETURN NULL; END IF;
  IF c.purpose='uv-login' THEN
    IF c.user_id IS NOT NULL THEN RETURN NULL; END IF;
  ELSIF c.user_id IS DISTINCT FROM u.id OR c.generation IS DISTINCT FROM generation THEN RETURN NULL;
  END IF;
  IF f.state='pending' THEN
    IF c.purpose NOT IN ('enrol-cookie','setup') OR f.expires_at<=now_at
      OR c.data->>'uvKeyId' IS DISTINCT FROM k.id
      OR code_hashes IS NULL OR cardinality(code_hashes)<>10
      OR cardinality(ARRAY(SELECT DISTINCT unnest(code_hashes)))<>10
      OR EXISTS(SELECT 1 FROM unnest(code_hashes) h WHERE h IS NULL OR h!~'^[a-f0-9]{64}$') OR set_id IS NULL THEN RETURN NULL; END IF;
    IF c.purpose='setup' AND NOT EXISTS(SELECT 1 FROM public.session original WHERE original.id=c.session_id
      AND original.user_id=u.id AND public.gf_b_hash(original.token)=c.session_bearer_hash
      AND public.gf_b_fresh(original.id,original.token) IS NOT NULL) THEN RETURN NULL; END IF;
    -- Восстановление требует нового пароля, а его здесь не передать: только через TOTP-complete.
    IF c.data ? 'recovery' THEN RETURN NULL; END IF;
    UPDATE auth_private.factors SET state='active',expires_at=NULL WHERE id=f.id;
    DELETE FROM auth_private.backup_codes WHERE user_id=u.id;
    INSERT INTO auth_private.backup_codes(code_hash,user_id,set_id,created_at) SELECT h,u.id,set_id,now_at FROM unnest(code_hashes) h;
    INSERT INTO public.auth_recovery_guards(user_id,enhanced_required) VALUES(u.id,true)
      ON CONFLICT(user_id) DO UPDATE SET enhanced_required=true;
    UPDATE auth_private.contexts SET state='spent' WHERE user_id=u.id;
    UPDATE public."user" SET security_generation=security_generation+1,updated_at=now_at WHERE id=u.id;
    RETURN jsonb_build_object('enrolled',true);
  END IF;
  IF f.state<>'active' OR c.purpose NOT IN ('reauth','uv-login') THEN RETURN NULL; END IF;
  IF new_id IS NULL OR new_token IS NULL OR issuance_id IS NULL OR length(new_token)<32 THEN RETURN NULL; END IF;
  IF c.purpose='reauth' THEN
    IF NOT EXISTS(SELECT 1 FROM public.session original WHERE original.id=c.session_id AND original.user_id=u.id
      AND public.gf_b_hash(original.token)=c.session_bearer_hash AND original.expires_at>now_at) THEN RETURN NULL; END IF;
    DELETE FROM public.session WHERE id=c.session_id;
  END IF;
  UPDATE auth_private.contexts SET state='spent' WHERE token_hash=c.token_hash;
  INSERT INTO public.session(id,token,user_id,security_generation,created_at,updated_at,expires_at)
    VALUES(new_id,new_token,u.id,u.security_generation,now_at,now_at,now_at+interval '30 days') RETURNING * INTO s;
  INSERT INTO auth_private.proofs(session_id,user_id,generation,bearer_hash,issuance_id,method,factor_id,verified_at)
    VALUES(s.id,u.id,u.security_generation,public.gf_b_hash(s.token),issuance_id,'uv',f.id,now_at);
  RETURN to_jsonb(s);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_uv_snapshot(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_enrol_key(text,jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_uv_context(text,text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gf_b_uv_finish(text,integer,text,text,integer,text,text,text,text,text[],text) FROM PUBLIC;

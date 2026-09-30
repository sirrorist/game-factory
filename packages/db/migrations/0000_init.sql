CREATE TABLE "game_saves" (
	"user_id" text NOT NULL,
	"game_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_saves_user_id_game_id_key_pk" PRIMARY KEY("user_id","game_id","key"),
	CONSTRAINT "game_saves_key_format" CHECK ("game_saves"."key" ~ '^[a-zA-Z0-9_.-]{1,64}$'),
	CONSTRAINT "game_saves_game_id_format" CHECK ("game_saves"."game_id" ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
	CONSTRAINT "game_saves_value_size" CHECK (octet_length("game_saves"."value") <= 65536)
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"game_id" text NOT NULL,
	"score" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scores_game_id_format" CHECK ("scores"."game_id" ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
	CONSTRAINT "scores_finite" CHECK ("scores"."score" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8))
);
--> statement-breakpoint
CREATE INDEX "scores_game_score_idx" ON "scores" USING btree ("game_id","score" DESC NULLS LAST);
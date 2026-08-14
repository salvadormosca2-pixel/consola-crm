-- Parte 2, fase 1 — paso 2 de 2: columnas, índices y tablas nuevas.
-- Los valores de enum que usa esta migración se agregaron en 0001_parte2_enums.

-- ── messaging_accounts ───────────────────────────────────────────────────
-- last_sent_at ordena la rotación y aplica la espera mínima.
ALTER TABLE "messaging_accounts" ADD COLUMN IF NOT EXISTS "last_sent_at" timestamp with time zone;--> statement-breakpoint

-- El calentamiento cuenta días de USO, no del almanaque: con warmup_started_on
-- sola no alcanza, porque un número que no mandó el martes no debe saltar de día.
ALTER TABLE "messaging_accounts" ADD COLUMN IF NOT EXISTS "warmup_day" smallint;--> statement-breakpoint
ALTER TABLE "messaging_accounts" ADD COLUMN IF NOT EXISTS "warmup_last_advanced_on" date;--> statement-breakpoint
ALTER TABLE "messaging_accounts" ADD COLUMN IF NOT EXISTS "warmup_repeats" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint

ALTER TABLE "messaging_accounts" ADD COLUMN IF NOT EXISTS "consecutive_failures" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messaging_accounts" ADD COLUMN IF NOT EXISTS "session_hint" text;--> statement-breakpoint
ALTER TABLE "messaging_accounts" ADD COLUMN IF NOT EXISTS "prep_checklist" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "messaging_accounts" ADD COLUMN IF NOT EXISTS "instance_token_encrypted" text;--> statement-breakpoint

-- El cupo de una cuenta que calienta sale de la escala global configurable,
-- no de una columna por cuenta.
ALTER TABLE "messaging_accounts" DROP COLUMN IF EXISTS "warmup_daily_cap";--> statement-breakpoint

-- La espera por defecto sube de 45 s a 4 minutos (sección 3, regla 3).
ALTER TABLE "messaging_accounts" ALTER COLUMN "min_gap_seconds" SET DEFAULT 240;--> statement-breakpoint
-- Un número nuevo no entra al reparto hasta completar el checklist.
ALTER TABLE "messaging_accounts" ALTER COLUMN "status" SET DEFAULT 'esperando_preparacion';--> statement-breakpoint

ALTER TABLE "messaging_accounts" DROP CONSTRAINT IF EXISTS "account_warmup_day";--> statement-breakpoint
ALTER TABLE "messaging_accounts" ADD CONSTRAINT "account_warmup_day"
  CHECK ("warmup_day" is null or "warmup_day" between 1 and 30);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "accounts_rotacion_idx" ON "messaging_accounts"
  USING btree ("channel", "sent_today", "last_sent_at")
  WHERE "status" in ('activa', 'calentando');--> statement-breakpoint

-- ── messages ─────────────────────────────────────────────────────────────
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "undone_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "pilot_id" uuid;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "messages_idempotency_uq" ON "messages"
  USING btree ("idempotency_key") WHERE "idempotency_key" is not null;--> statement-breakpoint

-- Índice del recuento de cupo: filtra por cuenta + rango de sent_at, con los
-- estados que consumen cupo ya excluidos del índice.
CREATE INDEX IF NOT EXISTS "messages_cupo_idx" ON "messages"
  USING btree ("account_id", "sent_at")
  WHERE "status" in ('enviado','entregado','leido','respondido') and "undone_at" is null;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "messages_pilot_idx" ON "messages"
  USING btree ("pilot_id") WHERE "pilot_id" is not null;--> statement-breakpoint

-- ── templates ────────────────────────────────────────────────────────────
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "is_opening" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "pilot_status" text DEFAULT 'sin_piloto' NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "approved_by" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "templates" ADD CONSTRAINT "templates_approved_by_users_id_fk"
    FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- ── contacts ─────────────────────────────────────────────────────────────
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "score_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

-- ── pilots ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pilots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "target_size" smallint DEFAULT 30 NOT NULL,
  "filters_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'en_curso' NOT NULL,
  "thresholds_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_sent_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid,
  "force_reason" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pilots" ADD CONSTRAINT "pilots_template_id_templates_id_fk"
    FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "pilots" ADD CONSTRAINT "pilots_account_id_messaging_accounts_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "public"."messaging_accounts"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "pilots" ADD CONSTRAINT "pilots_resolved_by_users_id_fk"
    FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "pilots" ADD CONSTRAINT "pilots_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "pilots_template_idx" ON "pilots"
  USING btree ("template_id", "created_at" DESC);--> statement-breakpoint
-- Una plantilla no puede tener dos pilotos abiertos a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS "pilots_abierto_uq" ON "pilots"
  USING btree ("template_id") WHERE "status" in ('en_curso', 'esperando');--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "messages" ADD CONSTRAINT "messages_pilot_id_pilots_id_fk"
    FOREIGN KEY ("pilot_id") REFERENCES "public"."pilots"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- ── ig_dispatch_state ────────────────────────────────────────────────────
-- Instagram se trabaja en bloques de una cuenta por vez. Es por usuario, no
-- global: si dos personas despachan a la vez, no se pisan el bloque.
CREATE TABLE IF NOT EXISTS "ig_dispatch_state" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "active_account_id" uuid,
  "block_started_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ig_dispatch_state" ADD CONSTRAINT "ig_dispatch_state_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ig_dispatch_state" ADD CONSTRAINT "ig_dispatch_state_active_account_id_messaging_accounts_id_fk"
    FOREIGN KEY ("active_account_id") REFERENCES "public"."messaging_accounts"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;

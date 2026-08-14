-- Chatwoot — paso 2 de 2: columnas, índices y configuración.
-- Chatwoot es la bandeja; la consola es el cerebro.

-- ── messaging_accounts ───────────────────────────────────────────────────
-- Un inbox de Chatwoot por instancia, mapeado a la cuenta. Sin el mapeo, la
-- cuenta no puede enviar: el mensaje saldría por el número equivocado.
ALTER TABLE "messaging_accounts" ADD COLUMN IF NOT EXISTS "chatwoot_inbox_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_chatwoot_inbox_uq" ON "messaging_accounts"
  USING btree ("chatwoot_inbox_id") WHERE "chatwoot_inbox_id" is not null;--> statement-breakpoint

-- ── contacts ─────────────────────────────────────────────────────────────
-- Espejo del contacto en Chatwoot, para abrir la conversación en un click.
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "chatwoot_contact_id" integer;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "chatwoot_conversation_id" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_chatwoot_idx" ON "contacts"
  USING btree ("chatwoot_contact_id") WHERE "chatwoot_contact_id" is not null;--> statement-breakpoint

-- ── messages ─────────────────────────────────────────────────────────────
-- send_mode deja de compartir enum con el modo de la cuenta: ahora hay cuatro
-- vías de salida y la de la cuenta sigue teniendo dos.
ALTER TABLE "messages" ALTER COLUMN "send_mode" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "send_mode" TYPE "public"."msg_send_mode"
  USING (case "send_mode"::text
           when 'api' then 'chatwoot'
           else 'manual'
         end)::"public"."msg_send_mode";--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "send_mode" SET DEFAULT 'manual';--> statement-breakpoint

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "chatwoot_message_id" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "sync_status" "public"."sync_status"
  DEFAULT 'ok' NOT NULL;--> statement-breakpoint

-- Chatwoot reintenta los webhooks: sin este índice, un reintento duplicaría el
-- mensaje y el consumo de cupo.
CREATE UNIQUE INDEX IF NOT EXISTS "messages_chatwoot_uq" ON "messages"
  USING btree ("chatwoot_message_id") WHERE "chatwoot_message_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_sync_idx" ON "messages"
  USING btree ("sync_status") WHERE "sync_status" <> 'ok';--> statement-breakpoint

-- ── chatwoot_config ──────────────────────────────────────────────────────
-- Una sola fila: es una instalación por despliegue.
CREATE TABLE IF NOT EXISTS "chatwoot_config" (
  "id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
  "base_url" text NOT NULL,
  "account_id" integer NOT NULL,
  "api_token_encrypted" text NOT NULL,
  "webhook_secret" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "last_webhook_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chatwoot_config_fila_unica" CHECK ("id" = 1)
);

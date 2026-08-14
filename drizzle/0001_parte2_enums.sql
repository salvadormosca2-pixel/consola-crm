-- Parte 2, fase 1 — paso 1 de 2: valores nuevos de enum.
--
-- Va en una migración propia porque Postgres no deja USAR un valor de enum
-- recién agregado dentro de la misma transacción que lo creó. El DEFAULT de
-- messaging_accounts.status usa 'esperando_preparacion', así que tiene que
-- esperar a que esta migración haya confirmado.

-- Estado de cuenta: el checklist previo no está completo, no entra al reparto.
ALTER TYPE "public"."account_status" ADD VALUE IF NOT EXISTS 'esperando_preparacion';--> statement-breakpoint

-- Etapas del embudo de la sección 2.
ALTER TYPE "public"."contact_stage" ADD VALUE IF NOT EXISTS 'seguimiento_1';--> statement-breakpoint
ALTER TYPE "public"."contact_stage" ADD VALUE IF NOT EXISTS 'seguimiento_2';--> statement-breakpoint
ALTER TYPE "public"."contact_stage" ADD VALUE IF NOT EXISTS 'seguimiento_3';--> statement-breakpoint
ALTER TYPE "public"."contact_stage" ADD VALUE IF NOT EXISTS 'perdido';--> statement-breakpoint
ALTER TYPE "public"."contact_stage" ADD VALUE IF NOT EXISTS 'sin_respuesta';--> statement-breakpoint
ALTER TYPE "public"."contact_stage" ADD VALUE IF NOT EXISTS 'no_contactar';

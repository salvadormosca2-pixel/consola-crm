-- Módulo de setters: equipo de contacto por Instagram desde el celular.
--
-- Se apoya en lo que ya existe. `contacts` sigue siendo el negocio, `meetings`
-- la reunión, `events` la bitácora y `messages` el historial de lo que se le
-- mandó a cada uno. Lo nuevo es quién trabaja cada lead, con qué cuenta de
-- Instagram, y cuánto cupo le queda a esa cuenta hoy.
--
-- `users` se EXTIENDE en vez de crear una tabla `usuarios` paralela: hay un
-- solo padrón de personas y una sola forma de entrar. Un segundo padrón sería
-- dos lugares donde revocar un acceso, que es la forma clásica de dejar a
-- alguien adentro sin querer.

CREATE TYPE "user_role" AS ENUM ('admin_madre', 'admin', 'setter');--> statement-breakpoint
CREATE TYPE "user_status" AS ENUM ('activo', 'pausado', 'baja');--> statement-breakpoint

-- Estados de un lead en manos de un setter.
--   asignado           le tocó y todavía no lo abrió
--   abierto            tocó "Abrir Instagram": el chat está abierto
--   saltado            lo dejó para el final de la cola de hoy
--   contactado         mandó el primer mensaje
--   segundo_enviado    mandó el segundo
--   respondido         el lead contestó; sale de su cola y entra a la del admin
--   cuenta_inexistente el perfil no existe; va a la pestaña de revisión
--   vencido            pasaron 48 h sin trabajarlo y volvió solo al pozo
--   devuelto           lo devolví yo a mano (baja del setter, reasignación)
--
-- Solo 'vencido' y 'devuelto' devuelven el lead al pozo. El resto lo mantiene
-- tomado, y eso es lo que garantiza que nunca haya dos setters en el mismo
-- negocio.
CREATE TYPE "lead_assignment_estado" AS ENUM (
  'asignado', 'abierto', 'saltado', 'contactado', 'segundo_enviado',
  'respondido', 'cuenta_inexistente', 'vencido', 'devuelto'
);--> statement-breakpoint

CREATE TYPE "setter_send_tipo" AS ENUM ('primero', 'segundo');--> statement-breakpoint

-- Los leads fríos scrapeados y los clientes propios no se tratan igual: los
-- primeros son del equipo de setters, los segundos del Despachador.
CREATE TYPE "contact_origen" AS ENUM ('cliente', 'scrapeado');--> statement-breakpoint

CREATE TYPE "notificacion_tipo" AS ENUM (
  'respondio', 'reunion_agendada', 'setter_inactivo', 'leads_por_vencer',
  'seguimientos_atrasados', 'cuenta_baja_respuesta', 'mensaje_sin_leer',
  'respuesta_de_setter', 'recordatorio'
);--> statement-breakpoint

CREATE TYPE "mensaje_equipo_nivel" AS ENUM ('aviso', 'importante', 'bloqueante');--> statement-breakpoint
CREATE TYPE "recordatorio_tipo" AS ENUM ('seguimientos', 'sin_contactar');--> statement-breakpoint

/* ── users: roles, estado y seguridad ─────────────────────────────────── */

ALTER TABLE "users"
  ADD COLUMN "role" "user_role" NOT NULL DEFAULT 'admin',
  ADD COLUMN "status" "user_status" NOT NULL DEFAULT 'activo',
  ADD COLUMN "must_change_password" boolean NOT NULL DEFAULT false,
  ADD COLUMN "last_login_at" timestamptz,
  ADD COLUMN "last_login_ip" text,
  ADD COLUMN "last_login_agent" text,
  ADD COLUMN "failed_attempts" smallint NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" timestamptz,
  ADD COLUMN "sessions_valid_from" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint

-- La cuenta más vieja de la base es la mía: la que creó todo lo demás.
UPDATE "users" SET "role" = 'admin_madre'
 WHERE "id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC, "id" ASC LIMIT 1);--> statement-breakpoint

-- Hay una sola admin madre y no puede haber dos.
CREATE UNIQUE INDEX "users_admin_madre_uq" ON "users" (("role"))
  WHERE "role" = 'admin_madre';--> statement-breakpoint

CREATE INDEX "users_role_idx" ON "users" ("role", "status");--> statement-breakpoint

-- Protección a nivel base: ni la app, ni otro admin, ni una consulta suelta
-- pueden borrar la cuenta madre ni degradarla. El único camino para moverla es
-- desactivar el disparador a mano desde psql, que ya es una decisión consciente.
CREATE FUNCTION "proteger_admin_madre"() RETURNS trigger AS $funcion$
BEGIN
  IF tg_op = 'DELETE' THEN
    IF old.role = 'admin_madre' THEN
      RAISE EXCEPTION 'La cuenta de admin madre no se puede borrar.';
    END IF;
    RETURN old;
  END IF;

  IF old.role = 'admin_madre' AND new.role <> 'admin_madre' THEN
    RAISE EXCEPTION 'La cuenta de admin madre no se puede degradar.';
  END IF;
  IF old.role = 'admin_madre' AND new.status <> 'activo' THEN
    RAISE EXCEPTION 'La cuenta de admin madre no se puede pausar ni dar de baja.';
  END IF;
  RETURN new;
END;
$funcion$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "users_proteger_admin_madre"
  BEFORE UPDATE OR DELETE ON "users"
  FOR EACH ROW EXECUTE FUNCTION "proteger_admin_madre"();--> statement-breakpoint

/* ── contacts y meetings: de quién es cada cosa ───────────────────────── */

ALTER TABLE "contacts"
  ADD COLUMN "origen" "contact_origen" NOT NULL DEFAULT 'cliente',
  ADD COLUMN "setter_id" uuid;--> statement-breakpoint

ALTER TABLE "meetings" ADD COLUMN "setter_id" uuid;--> statement-breakpoint

/* ── setters ──────────────────────────────────────────────────────────── */

CREATE TABLE "setters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "tanda_diaria" smallint NOT NULL DEFAULT 60,
  "variante" smallint NOT NULL DEFAULT 0,
  "cuenta_activa_id" uuid,
  "cuenta_activa_desde" timestamptz,
  "recordatorio_automatico" boolean NOT NULL DEFAULT false,
  "hora_recordatorio" time NOT NULL DEFAULT '10:00',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "setters_user_uq" UNIQUE ("user_id"),
  CONSTRAINT "setters_tanda" CHECK ("tanda_diaria" BETWEEN 1 AND 500)
);--> statement-breakpoint

CREATE TABLE "setter_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "setter_id" uuid NOT NULL REFERENCES "setters"("id") ON DELETE CASCADE,
  "ig_username" text NOT NULL,
  "cupo_diario" smallint NOT NULL DEFAULT 30,
  "enviados_hoy" smallint NOT NULL DEFAULT 0,
  "contador_fecha" date,
  "orden" smallint NOT NULL DEFAULT 1,
  "activa" boolean NOT NULL DEFAULT true,
  "ultimo_envio_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "setter_accounts_cupo" CHECK ("cupo_diario" BETWEEN 1 AND 100)
);--> statement-breakpoint

-- Una cuenta de Instagram pertenece a un solo setter: si dos la comparten,
-- el cupo de 30 se cuenta dos veces y la cuenta se quema.
CREATE UNIQUE INDEX "setter_accounts_ig_uq" ON "setter_accounts" (lower("ig_username"));--> statement-breakpoint
CREATE INDEX "setter_accounts_setter_idx" ON "setter_accounts" ("setter_id", "orden");--> statement-breakpoint

ALTER TABLE "setters" ADD CONSTRAINT "setters_cuenta_activa_fk"
  FOREIGN KEY ("cuenta_activa_id") REFERENCES "setter_accounts"("id") ON DELETE SET NULL;--> statement-breakpoint

ALTER TABLE "contacts" ADD CONSTRAINT "contacts_setter_fk"
  FOREIGN KEY ("setter_id") REFERENCES "setters"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_setter_fk"
  FOREIGN KEY ("setter_id") REFERENCES "setters"("id") ON DELETE SET NULL;--> statement-breakpoint

CREATE INDEX "contacts_setter_idx" ON "contacts" ("setter_id") WHERE "setter_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "meetings_setter_idx" ON "meetings" ("setter_id") WHERE "setter_id" IS NOT NULL;--> statement-breakpoint

-- El pozo: leads fríos con Instagram que todavía no tomó nadie.
CREATE INDEX "contacts_pozo_idx" ON "contacts" ("score" DESC, "created_at")
  WHERE "origen" = 'scrapeado' AND "discarded_at" IS NULL AND "ig_username" IS NOT NULL;--> statement-breakpoint

/* ── lead_assignments ─────────────────────────────────────────────────── */

CREATE TABLE "lead_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "setter_id" uuid NOT NULL REFERENCES "setters"("id") ON DELETE CASCADE,
  "setter_account_id" uuid REFERENCES "setter_accounts"("id") ON DELETE SET NULL,
  "asignado_at" timestamptz NOT NULL DEFAULT now(),
  "vence_at" timestamptz NOT NULL,
  "estado" "lead_assignment_estado" NOT NULL DEFAULT 'asignado',
  "abierto_at" timestamptz,
  "pospuesto_at" timestamptz,
  "contactado_at" timestamptz,
  "segundo_programado_at" timestamptz,
  "segundo_mensaje_at" timestamptz,
  "respondido_at" timestamptz,
  "devuelto_at" timestamptz,
  "devuelto_motivo" text,
  "marcado_por" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "nota" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

-- La regla que no se negocia: nunca dos setters al mismo lead. Un negocio
-- puede tener muchas asignaciones a lo largo del tiempo, pero como máximo una
-- que no haya vuelto al pozo.
CREATE UNIQUE INDEX "lead_assignments_activo_uq" ON "lead_assignments" ("contact_id")
  WHERE "estado" NOT IN ('vencido', 'devuelto');--> statement-breakpoint

CREATE INDEX "lead_assignments_cola_idx" ON "lead_assignments" ("setter_id", "estado");--> statement-breakpoint
CREATE INDEX "lead_assignments_vencimiento_idx" ON "lead_assignments" ("vence_at")
  WHERE "estado" IN ('asignado', 'abierto', 'saltado');--> statement-breakpoint
CREATE INDEX "lead_assignments_segundo_idx" ON "lead_assignments" ("segundo_programado_at")
  WHERE "estado" = 'contactado' AND "segundo_programado_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "lead_assignments_contacto_idx" ON "lead_assignments" ("contact_id", "created_at" DESC);--> statement-breakpoint

/* ── setter_sends: la autoridad del cupo ──────────────────────────────── */

-- Una fila por mensaje efectivamente mandado. El cupo de 30 se recuenta desde
-- acá dentro de la transacción, igual que el de las cuentas de la consola se
-- recuenta desde `messages`: un contador guardado se desincroniza, un recuento
-- no. Deshacer sella `undone_at` en vez de borrar, así el cupo se libera solo.
CREATE TABLE "setter_sends" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "assignment_id" uuid NOT NULL REFERENCES "lead_assignments"("id") ON DELETE CASCADE,
  "setter_id" uuid NOT NULL REFERENCES "setters"("id") ON DELETE CASCADE,
  "setter_account_id" uuid NOT NULL REFERENCES "setter_accounts"("id") ON DELETE RESTRICT,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "tipo" "setter_send_tipo" NOT NULL,
  "ops_date" date NOT NULL,
  "sent_at" timestamptz NOT NULL DEFAULT now(),
  "undone_at" timestamptz,
  "message_id" uuid REFERENCES "messages"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

-- Un lead recibe el primer mensaje una vez y el segundo una vez. Es lo que
-- absorbe el doble toque, el reintento de red y la marca que se sincronizó
-- dos veces desde el celular sin señal.
CREATE UNIQUE INDEX "setter_sends_unico" ON "setter_sends" ("assignment_id", "tipo")
  WHERE "undone_at" IS NULL;--> statement-breakpoint
CREATE INDEX "setter_sends_cupo_idx" ON "setter_sends" ("setter_account_id", "ops_date")
  WHERE "undone_at" IS NULL;--> statement-breakpoint
CREATE INDEX "setter_sends_setter_idx" ON "setter_sends" ("setter_id", "ops_date")
  WHERE "undone_at" IS NULL;--> statement-breakpoint

/* ── notificaciones ───────────────────────────────────────────────────── */

CREATE TABLE "notificaciones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tipo" "notificacion_tipo" NOT NULL,
  "para_usuario_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "setter_id" uuid REFERENCES "setters"("id") ON DELETE SET NULL,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE CASCADE,
  "meeting_id" uuid REFERENCES "meetings"("id") ON DELETE CASCADE,
  "texto" text NOT NULL,
  "enlace" text,
  "clave" text,
  "leida" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX "notificaciones_clave_uq" ON "notificaciones" ("clave")
  WHERE "clave" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notificaciones_bandeja_idx" ON "notificaciones" ("para_usuario_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "notificaciones_sin_leer_idx" ON "notificaciones" ("created_at" DESC) WHERE NOT "leida";--> statement-breakpoint

/* ── recordatorios ────────────────────────────────────────────────────── */

-- Queda registrado cada aviso que le mando a un setter: cuándo, por qué, y con
-- qué números. Si le mandé cinco en la semana y no hizo nada, eso es un dato.
CREATE TABLE "recordatorios" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "setter_id" uuid NOT NULL REFERENCES "setters"("id") ON DELETE CASCADE,
  "tipo" "recordatorio_tipo" NOT NULL,
  "automatico" boolean NOT NULL DEFAULT false,
  "pendientes" smallint NOT NULL DEFAULT 0,
  "atrasados" smallint NOT NULL DEFAULT 0,
  "dias_atraso" smallint NOT NULL DEFAULT 0,
  "texto" text NOT NULL,
  "enviado_por" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "visto_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX "recordatorios_setter_idx" ON "recordatorios" ("setter_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "recordatorios_pendiente_idx" ON "recordatorios" ("setter_id")
  WHERE "visto_at" IS NULL;--> statement-breakpoint

/* ── mensajes al equipo ───────────────────────────────────────────────── */

CREATE TABLE "mensajes_equipo" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "autor_admin" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "nivel" "mensaje_equipo_nivel" NOT NULL DEFAULT 'aviso',
  "titulo" text NOT NULL,
  "cuerpo" text NOT NULL,
  "texto_para_copiar" text,
  "fijado" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX "mensajes_equipo_idx" ON "mensajes_equipo" ("created_at" DESC);--> statement-breakpoint
CREATE INDEX "mensajes_equipo_fijado_idx" ON "mensajes_equipo" ("created_at" DESC) WHERE "fijado";--> statement-breakpoint

CREATE TABLE "mensajes_destinatarios" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "mensaje_id" uuid NOT NULL REFERENCES "mensajes_equipo"("id") ON DELETE CASCADE,
  "setter_id" uuid NOT NULL REFERENCES "setters"("id") ON DELETE CASCADE,
  "leido_at" timestamptz,
  "respuesta" text,
  "respondido_at" timestamptz,
  "alertado_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX "mensajes_destinatarios_uq" ON "mensajes_destinatarios" ("mensaje_id", "setter_id");--> statement-breakpoint
CREATE INDEX "mensajes_destinatarios_setter_idx" ON "mensajes_destinatarios" ("setter_id", "leido_at");--> statement-breakpoint

/* ── suscripciones push ───────────────────────────────────────────────── */

CREATE TABLE "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "last_ok_at" timestamptz,
  "fallos" smallint NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX "push_subscriptions_endpoint_uq" ON "push_subscriptions" ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");

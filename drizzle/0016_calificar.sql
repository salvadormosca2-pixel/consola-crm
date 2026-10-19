/* ── Un solo mensaje de entrada, y el texto escrito a mano ───────────────
   Se va el modelo de la oferta entera:

     · el segundo mensaje (la oferta) y su reloj,
     · a cuál de los dos contestó el lead,
     · el interés que se le marcaba después (interesa / tibio / no interesa),
     · la cola de clasificación que decidía todo eso.

   Queda un recorrido con una sola decisión adentro: se manda el primer
   mensaje, y si el lead contesta y vale la pena, se lo **califica**. Calificar
   es lo único que abre la escalera de seguimiento.

   Las columnas se borran en lugar de quedar en null para siempre: mientras
   existan, media docena de consultas las siguen mirando y la pantalla muestra
   números de un modelo que ya no se usa. Lo que pasó queda igual en `events` y
   en `messages`, que es donde se lee el historial. */

CREATE TABLE "lead_textos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "assignment_id" uuid NOT NULL REFERENCES "lead_assignments"("id") ON DELETE CASCADE,
  /* 1 el primer mensaje; 3, 10, 11 y 12 los escalones del seguimiento. */
  "paso" smallint NOT NULL,
  "body" text NOT NULL,
  "escrito_por" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

/* Uno por lead y por paso. El admin lo reescribe hasta que le gusta y lo que
   vale es la última versión, no una pila de borradores. */
CREATE UNIQUE INDEX "lead_textos_unico"
  ON "lead_textos" ("assignment_id", "paso");--> statement-breakpoint

ALTER TABLE "lead_assignments"
  ADD COLUMN "calificado_at" timestamptz,
  ADD COLUMN "calificado_por" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint

/* Lo que ya estaba clasificado como "le interesa" es exactamente lo que hoy se
   llama calificado: contestó y se decidió seguirlo. Se conserva para que los
   leads vivos no pierdan su lugar en la escalera. */
UPDATE "lead_assignments"
   SET "calificado_at" = "clasificado_at",
       "calificado_por" = "clasificado_por",
       "estado" = 'calificado'
 WHERE "interes" = 'interesa'
   AND "estado" NOT IN ('vencido', 'devuelto', 'cuenta_inexistente');--> statement-breakpoint

DROP INDEX IF EXISTS "lead_assignments_segundo_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "lead_assignments_oferta_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "lead_assignments_sin_clasificar_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "lead_assignments_respuesta_idx";--> statement-breakpoint

ALTER TABLE "lead_assignments"
  DROP CONSTRAINT IF EXISTS "lead_interes_solo_con_oferta";--> statement-breakpoint

ALTER TABLE "lead_assignments"
  DROP COLUMN "segundo_programado_at",
  DROP COLUMN "segundo_mensaje_at",
  DROP COLUMN "respondio_a",
  DROP COLUMN "interes",
  DROP COLUMN "clasificado_at",
  DROP COLUMN "clasificado_por";--> statement-breakpoint

/* Los que contestaron, por setter y por fecha: es la lista de la que salen los
   calificados. Antes este índice colgaba de `respondio_a`, que ya no existe. */
CREATE INDEX "lead_assignments_respuesta_idx"
  ON "lead_assignments" ("setter_id", "respondido_at" DESC)
  WHERE "respondido_at" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "lead_assignments_calificado_idx"
  ON "lead_assignments" ("setter_id", "calificado_at" DESC)
  WHERE "calificado_at" IS NOT NULL;--> statement-breakpoint

/* `tipo` era "primero o segundo". Con un solo mensaje de entrada, el paso ya
   lo dice todo y la columna no agrega nada. */
ALTER TABLE "setter_sends" DROP COLUMN "tipo";--> statement-breakpoint

DROP TYPE IF EXISTS "setter_send_tipo";--> statement-breakpoint
DROP TYPE IF EXISTS "lead_interes";

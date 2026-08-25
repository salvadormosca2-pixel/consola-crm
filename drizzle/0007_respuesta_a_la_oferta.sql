-- Dos clases de "respondió", que no significan lo mismo.
--
--   1. Respondió al PRIMER mensaje. Todavía no sabe a qué nos dedicamos: el
--      mensaje de entrada es un gancho, no una oferta. Acá entra el equipo a
--      seguir la conversación y contarle.
--
--   2. Respondió al SEGUNDO mensaje, que es el que lleva la oferta. Ya sabe qué
--      le estamos ofreciendo y está diciendo que sí o que no. Es una respuesta
--      calificada, y vale muchísimo más que la primera.
--
-- Mezclarlas en un solo estado hacía que la cola de trabajo del admin tuviera
-- adentro conversaciones sin empezar y decisiones ya tomadas, que se atienden
-- de maneras completamente distintas.

CREATE TYPE "lead_interes" AS ENUM ('interesa', 'no_interesa');--> statement-breakpoint

ALTER TABLE "lead_assignments"
  -- A cuál de los dos mensajes contestó. Se deduce del estado al marcar y se
  -- sella acá: después el estado sigue cambiando y el dato se perdería.
  ADD COLUMN "respondio_a" "setter_send_tipo",
  -- Solo tiene sentido cuando respondió a la oferta. Un "me interesa" antes de
  -- saber qué le ofrecemos no quiere decir nada.
  ADD COLUMN "interes" "lead_interes";--> statement-breakpoint

ALTER TABLE "lead_assignments"
  ADD CONSTRAINT "lead_interes_solo_con_oferta"
  CHECK ("interes" IS NULL OR "respondio_a" = 'segundo');--> statement-breakpoint

-- Las dos vistas del panel: los que abrieron conversación y los que ya
-- contestaron la oferta.
CREATE INDEX "lead_assignments_respuesta_idx" ON "lead_assignments"
  ("respondio_a", "respondido_at" DESC)
  WHERE "respondio_a" IS NOT NULL;--> statement-breakpoint

-- Los que ya recibieron la oferta y todavía no dijeron nada. Es la lista que
-- mira el setter para cargar las respuestas que llegan días después.
CREATE INDEX "lead_assignments_oferta_idx" ON "lead_assignments"
  ("setter_id", "segundo_mensaje_at" DESC)
  WHERE "estado" = 'segundo_enviado';

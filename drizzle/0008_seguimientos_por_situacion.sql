-- El seguimiento deja de ser "el segundo mensaje" y pasa a ser una secuencia
-- que se ramifica según dónde se trabó el lead.
--
-- Hasta acá había dos mensajes fijos: entrada y oferta. Pero un lead que
-- contestó el primero y después se calló no necesita lo mismo que uno que
-- nunca dijo nada, y ninguno de los dos necesita lo mismo que uno al que le
-- interesó la oferta y después desapareció. Son tres silencios distintos y
-- se recuperan con tres mensajes distintos.
--
-- Las cinco situaciones, que son los cinco mensajes que se configuran:
--
--   1  entrada                 nunca recibió nada
--   2  la oferta               recibió la entrada y no contestó
--   3  no contestó nunca       recibió los dos y sigue callado
--   4  contestó y se enfrió    contestó la entrada y después desapareció
--   5  le interesó y se enfrió dijo que le interesaba y después desapareció
--
-- `segundo_programado_at` se reemplaza por un par genérico —cuándo y cuál—,
-- porque con cinco pasos una columna por paso no escala.

ALTER TABLE "lead_assignments"
  -- Qué mensaje le toca la próxima vez. null = no le toca nada más.
  ADD COLUMN "proximo_paso" smallint,
  -- Cuándo le toca. Hasta que llega esa fecha, el lead no aparece en la cola.
  ADD COLUMN "proximo_seguimiento_at" timestamptz;--> statement-breakpoint

-- Lo que ya estaba programado como "segundo mensaje" es el paso 2.
UPDATE "lead_assignments"
   SET "proximo_paso" = 2, "proximo_seguimiento_at" = "segundo_programado_at"
 WHERE "segundo_programado_at" IS NOT NULL AND "estado" = 'contactado';--> statement-breakpoint

-- Los que ya recibieron los dos mensajes entran a la rama de reenganche.
UPDATE "lead_assignments"
   SET "proximo_paso" = 3,
       "proximo_seguimiento_at" = COALESCE("segundo_mensaje_at", now()) + interval '3 days'
 WHERE "estado" = 'segundo_enviado' AND "respondido_at" IS NULL;--> statement-breakpoint

-- La consulta de la cola del setter: qué leads tienen seguimiento vencido.
CREATE INDEX "lead_assignments_proximo_idx" ON "lead_assignments"
  ("setter_id", "proximo_seguimiento_at")
  WHERE "proximo_seguimiento_at" IS NOT NULL;--> statement-breakpoint

-- El barrido de las tareas del reloj mira esta sola columna.
CREATE INDEX "lead_assignments_seguimiento_vencido_idx" ON "lead_assignments"
  ("proximo_seguimiento_at")
  WHERE "proximo_seguimiento_at" IS NOT NULL;

-- Las pistas: un seguimiento deja de ser un mensaje y pasa a ser una escalera.
--
-- Antes cada situación tenía un solo texto, así que "insistirle al que se
-- calló" era un mensaje y se acababa. Ahora silencio y tibio tienen cuatro
-- escalones cada una y el reintento de apertura dos, cada uno con su texto y su
-- ángulo. Los números de paso llegan hasta el 18.

-- 1. El rango de pasos.
--
-- El CHECK quedó en 1..5 desde que se agregó, pero las situaciones que marca el
-- setter (6 le interesa, 7 no le interesa, 8 agendó reunión) ya usan números más
-- altos: hoy, en producción, registrar uno de esos envíos viola la restricción y
-- el envío falla. Se arregla acá de paso, y el rango pasa a cubrir las pistas
-- completas.
ALTER TABLE "setter_sends" DROP CONSTRAINT IF EXISTS "setter_sends_paso_valido";--> statement-breakpoint

ALTER TABLE "setter_sends"
  ADD CONSTRAINT "setter_sends_paso_valido" CHECK ("paso" BETWEEN 1 AND 18);--> statement-breakpoint

-- 2. Cuándo se clasificó la respuesta a la oferta.
--
-- Contestar la oferta no dice a qué pista va el lead: eso lo decide una persona
-- mirando el hilo. Hasta que lo decida, el lead está parado. Esta columna es la
-- que hace visible esa espera y permite medirla: es el cuello de botella más
-- caro de la operación, porque son leads que ya hablaron.
ALTER TABLE "lead_assignments"
  ADD COLUMN IF NOT EXISTS "clasificado_at" timestamptz;--> statement-breakpoint

ALTER TABLE "lead_assignments"
  ADD COLUMN IF NOT EXISTS "clasificado_por" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint

-- Lo que ya venía clasificado de antes no tiene que aparecer como pendiente: si
-- alguien marcó interés o rechazo, la decisión ya está tomada.
UPDATE "lead_assignments"
   SET "clasificado_at" = COALESCE("respondido_at", now())
 WHERE "clasificado_at" IS NULL
   AND "interes" IS NOT NULL;--> statement-breakpoint

-- La cola se ordena por antigüedad de la respuesta, así que el índice la cubre
-- entera: los que contestaron la oferta y todavía nadie tocó.
CREATE INDEX IF NOT EXISTS "lead_assignments_sin_clasificar_idx"
  ON "lead_assignments" ("respondido_at")
  WHERE "respondio_a" = 'segundo' AND "clasificado_at" IS NULL;--> statement-breakpoint

-- 3. Los leads parados en un paso que ya no existe.
--
-- 4 y 5 eran reenganches de alguien que alguna vez habló; 9 era el cierre de
-- todos. Las tres cosas las hace ahora la pista de tibio, así que los que están
-- esperando uno de esos pasos se mudan a ella conservando su fecha: 4 y 5 al
-- primer escalón, 9 al último, que es el que cerraba.
--
-- Los números viejos no se reusan nunca: los envíos y los textos ya escritos
-- los apuntan, y el historial tiene que poder decir qué se mandó.
UPDATE "lead_assignments" SET "proximo_paso" = 13
 WHERE "proximo_paso" IN (4, 5);--> statement-breakpoint

UPDATE "lead_assignments" SET "proximo_paso" = 16
 WHERE "proximo_paso" = 9;

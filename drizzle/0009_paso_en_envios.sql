-- Con cinco situaciones, "primero o segundo" ya no alcanza para saber qué se
-- mandó. Cada envío guarda su paso.
--
-- `tipo` se conserva y se sigue llenando (1 = primero, el resto = segundo):
-- lo usan los contadores de seguimientos y la línea de tiempo, y cambiarlos
-- todos a la vez no aporta nada. Lo que sí cambia es la garantía de unicidad,
-- que ahora es por paso: un lead recibe cada uno de los cinco mensajes una
-- sola vez.

ALTER TABLE "setter_sends" ADD COLUMN "paso" smallint;--> statement-breakpoint

UPDATE "setter_sends" SET "paso" = CASE WHEN "tipo" = 'primero' THEN 1 ELSE 2 END
 WHERE "paso" IS NULL;--> statement-breakpoint

ALTER TABLE "setter_sends" ALTER COLUMN "paso" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "setter_sends"
  ADD CONSTRAINT "setter_sends_paso_valido" CHECK ("paso" BETWEEN 1 AND 5);--> statement-breakpoint

-- La unicidad pasa a ser por paso. Es lo que absorbe el doble toque, el
-- reintento de red y la marca que se sincronizó dos veces desde un celular
-- que estaba sin señal.
DROP INDEX IF EXISTS "setter_sends_unico";--> statement-breakpoint

CREATE UNIQUE INDEX "setter_sends_unico" ON "setter_sends" ("assignment_id", "paso")
  WHERE "undone_at" IS NULL;

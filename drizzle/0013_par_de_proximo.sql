-- `proximo_paso` y `proximo_seguimiento_at` son un par: o están los dos, o no
-- está ninguno.
--
-- Si se separan, la cola del setter falla de la peor manera posible y en
-- silencio. Cuando hay fecha vencida pero el paso quedó en null, `armarCola`
-- cae a su valor por defecto —el paso 1— y le muestra al setter el mensaje de
-- **entrada** para alguien con quien ya viene hablando: "Hola! Vi el perfil de
-- tu negocio, quería hacerte una consulta" a un lead que hace dos semanas te
-- pidió precio. No hay error, no hay aviso: sale y quema la conversación.
--
-- Hoy los cinco lugares que los escriben los mueven juntos, pero eso es una
-- convención, no una garantía. Acá pasa a ser una garantía.

UPDATE "lead_assignments"
   SET "proximo_paso" = NULL, "proximo_seguimiento_at" = NULL
 WHERE ("proximo_paso" IS NULL) <> ("proximo_seguimiento_at" IS NULL);--> statement-breakpoint

ALTER TABLE "lead_assignments"
  ADD CONSTRAINT "lead_proximo_par" CHECK (
    ("proximo_paso" IS NULL) = ("proximo_seguimiento_at" IS NULL)
  );

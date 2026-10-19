/* ── La pestaña Revisar mostraba el problema de ayer ─────────────────────
   La regla vieja mandaba a revisar cualquier fila que tuviera un aviso, y
   una lista scrapeada entera se lleva el aviso del teléfono roto aunque el
   `@usuario` esté impecable. La regla ya está arreglada, pero la etiqueta
   quedó escrita en `import_batch_items`: la pantalla seguía mostrando
   cientos de leads buenos esperando que alguien los mirara.

   Esto reescribe esas etiquetas con la regla nueva: se revisa la fila que
   **no se puede trabajar**, y eso es no tener el canal por el que se la va
   a contactar. Las filas que nunca se pudieron importar (`error`, sin
   contacto) no se tocan: ahí sí no hay nada resuelto.

   Después se recalculan los contadores del lote, que es el número que se
   ve en el historial. */

UPDATE "import_batch_items" i
   SET "action" = 'insertado'
  FROM "contacts" c
 WHERE i."contact_id" = c."id"
   AND i."action" = 'revisar'
   AND c."discarded_at" IS NULL
   AND CASE WHEN c."origen" = 'scrapeado'
            THEN c."ig_username" IS NOT NULL
            ELSE c."phone_e164" IS NOT NULL
       END;--> statement-breakpoint

/* ── Y los leads que entraron como "cliente propio" sin querer ───────────
   El importador arrancaba en "cliente propio" y equivocarse no daba
   ningún error: los contactos entraban a la base y no le aparecían a
   ningún setter, porque el pozo mira `origen = 'scrapeado'`. Un lead con
   `@usuario` y **sin teléfono** no se puede trabajar de ninguna otra
   forma, así que quedaba fuera de circulación sin que nada lo dijera.

   Esos se pasan a lead scrapeado. Los que tienen las dos cosas no se
   tocan: ahí la elección puede haber sido a propósito. */

UPDATE "contacts"
   SET "origen" = 'scrapeado',
       "updated_at" = now()
 WHERE "origen" = 'cliente'
   AND "ig_username" IS NOT NULL
   AND "phone_e164" IS NULL
   AND "discarded_at" IS NULL;--> statement-breakpoint

UPDATE "import_batches" b
   SET "needs_review" = (
     SELECT count(*) FROM "import_batch_items" i
      WHERE i."batch_id" = b."id" AND i."action" IN ('revisar', 'error')
   );

/* ── referencias: qué contestar cuando preguntan ──────────────────────────
   Las preguntas que los clientes hacen siempre, con la respuesta que el admin
   quiere que se dé. No son mensajes que se mandan solos: son la chuleta que el
   setter abre cuando le preguntan algo y no sabe qué decir.

   Igual que todo lo demás del módulo, el texto lo escribe el admin. El sistema
   no completa ni sugiere nada. */

CREATE TABLE "referencias" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "categoria" text NOT NULL,
  "pregunta" text NOT NULL,
  "respuesta" text NOT NULL,
  /* Aclaración interna para el setter. Nunca se copia al chat: es el "esto
     contestalo solo si ya preguntó el precio", no parte de la respuesta. */
  "nota" text,
  "orden" integer NOT NULL DEFAULT 0,
  "activa" boolean NOT NULL DEFAULT true,
  "actualizado_por" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

/* Dos veces la misma pregunta en la misma categoría es un error de carga, no
   una decisión: el setter que busca encuentra dos respuestas distintas y no
   sabe cuál usar. Lo corta la base, no la pantalla. */
CREATE UNIQUE INDEX "referencias_pregunta_uq"
  ON "referencias" ("categoria", lower("pregunta"));--> statement-breakpoint

/* El orden en que las lee el setter: por categoría, y adentro lo que el admin
   puso primero. */
CREATE INDEX "referencias_orden_idx"
  ON "referencias" ("categoria", "orden", "created_at");--> statement-breakpoint

/* La consulta del setter trae solo las activas y es la que más corre. */
CREATE INDEX "referencias_activas_idx"
  ON "referencias" ("orden", "created_at") WHERE "activa";

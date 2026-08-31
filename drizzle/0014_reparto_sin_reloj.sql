-- El reparto automático nunca salía en producción.
--
-- Estaba programado en `vercel.json` —un cron cada quince minutos contra
-- /api/tareas— y la aplicación corre en Railway, que no lee ese archivo. Nadie
-- llamaba a la ruta, así que el reparto "automático" no existía: el pozo se
-- quedaba lleno hasta que alguien apretaba el botón a mano.
--
-- La solución no es pedir otro programador: es que el reparto del día se
-- resuelva al abrir la app, igual que el vencimiento de leads, y no dependa de
-- que un reloj externo esté vivo. Para eso hace falta que dos pantallas
-- abiertas al mismo tiempo no lo disparen dos veces.
--
-- Este índice es esa garantía. La marca del reparto del día es un `events` con
-- `automatico: true` y el día adentro; con el índice único, la primera pantalla
-- que la inserta se lleva el turno y la segunda choca y no hace nada. Es la
-- misma idea que `notificaciones_clave_uq`: el candado lo pone la base, no el
-- código, porque el código corre en varias instancias a la vez.

-- Por si alguna vez salieron dos el mismo día: sin esto, crear el índice falla
-- y la aplicación no arranca. Se queda el primero, que es el que repartió.
DELETE FROM "events" e
 USING "events" otro
 WHERE e."type" = 'leads_asignados'
   AND otro."type" = 'leads_asignados'
   AND e."payload_jsonb"->>'automatico' = 'true'
   AND otro."payload_jsonb"->>'automatico' = 'true'
   AND e."payload_jsonb"->>'dia' = otro."payload_jsonb"->>'dia'
   AND (e."created_at", e."id") > (otro."created_at", otro."id");--> statement-breakpoint

CREATE UNIQUE INDEX "events_reparto_automatico_uq"
  ON "events" (("payload_jsonb"->>'dia'))
  WHERE "type" = 'leads_asignados'
    AND "payload_jsonb"->>'automatico' = 'true'
    AND "payload_jsonb"->>'dia' IS NOT NULL;

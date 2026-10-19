/* ── Los seguimientos del modelo viejo no se trabajan ────────────────────
   La migración anterior cambió el recorrido pero dejó a cada lead con el
   paso que tenía programado. Eso deja dos clases de lead imposibles:

     · el que tiene programado un paso **retirado** —la oferta, los
       reenganches sueltos, la escalera del tibio, los reintentos de
       apertura—. Ese paso ya no existe en el modelo, así que la pantalla de
       Textos no lo ofrece y nadie puede escribirle el mensaje: el lead
       aparece en el celular del setter bloqueado para siempre.
     · el que tiene un seguimiento programado **sin estar calificado**.
       Calificar es ahora la única puerta al seguimiento, y estos venían de
       cuando la cadena los programaba sola por silencio.

   Los dos se limpian: pierden lo que tenían programado y quedan como
   contactados a secas. No se borra nada más —su ficha, sus mensajes y sus
   reuniones siguen— y si alguno vale la pena, se lo califica y arranca su
   escalera desde cero, que es lo que se pidió: empezar de nuevo sin
   arrastrar seguimientos viejos.

   El par se pone en null de una: el check `lead_proximo_par` no admite que
   quede una mitad sola. */

UPDATE "lead_assignments"
   SET "proximo_paso" = NULL,
       "proximo_seguimiento_at" = NULL
 WHERE "proximo_paso" IS NOT NULL
   AND ("calificado_at" IS NULL OR "proximo_paso" NOT IN (3, 10, 11, 12));

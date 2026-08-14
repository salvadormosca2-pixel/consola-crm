-- Índices de las pantallas de Seguimientos y Respondieron.
--
-- Con 240 contactos las dos rondaban el segundo, que es el techo que se fijó
-- para toda la app. Con 1.000 lo pasaban. El problema no era el volumen sino
-- que las dos consultas recorrían tablas enteras.

-- Último mensaje entrante de un contacto: lo pide la bandeja para mostrar qué
-- dijo sin abrir la ficha. Sin este índice es un scan de messages por cada fila.
CREATE INDEX IF NOT EXISTS "messages_entrantes_idx" ON "messages"
  USING btree ("contact_id", "created_at" DESC)
  WHERE "direction" = 'in';--> statement-breakpoint

-- La cola de seguimientos: los que todavía no contestaron y ya recibieron al
-- menos un mensaje, ordenados por cuándo les toca.
CREATE INDEX IF NOT EXISTS "contacts_seguimiento_idx" ON "contacts"
  USING btree ("next_followup_at", "score" DESC)
  WHERE "discarded_at" is null and "received_count" = 0 and "sent_count" > 0;--> statement-breakpoint

-- La bandeja de los que contestaron y falta clasificar, por tiempo de espera.
CREATE INDEX IF NOT EXISTS "contacts_respondieron_idx" ON "contacts"
  USING btree ("last_inbound_at")
  WHERE "discarded_at" is null and "received_count" > 0;--> statement-breakpoint

-- Contar en qué paso quedó cada uno, para ver dónde se traba la gente.
CREATE INDEX IF NOT EXISTS "contacts_paso_idx" ON "contacts"
  USING btree ("sent_count")
  WHERE "discarded_at" is null and "received_count" = 0;

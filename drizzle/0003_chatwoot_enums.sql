-- Chatwoot — paso 1 de 2: tipos nuevos.
--
-- Va aparte porque la migración siguiente USA estos tipos, y Postgres no deja
-- usar un tipo enum recién creado con valores nuevos dentro de la misma
-- transacción. `scripts/migrate.ts` confirma cada archivo por separado.

-- Por dónde salió cada mensaje. Es distinto del modo de la cuenta: un mismo
-- número puede haber mandado por las cuatro vías el mismo día, y cada una se
-- concilia distinto.
--   manual           → abrí el chat desde la consola y confirmé
--   chatwoot         → lo mandó la consola por la API de Chatwoot
--   evolution        → respaldo, Chatwoot no respondía
--   chatwoot_agente  → lo escribí a mano dentro de Chatwoot, llegó por webhook
CREATE TYPE "public"."msg_send_mode" AS ENUM('manual', 'chatwoot', 'evolution', 'chatwoot_agente');--> statement-breakpoint

CREATE TYPE "public"."sync_status" AS ENUM('ok', 'sin_sincronizar', 'duplicado_descartado');

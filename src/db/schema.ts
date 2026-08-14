import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  accountModeEnum,
  accountStatusEnum,
  channelEnum,
  contactStageEnum,
  importActionEnum,
  meetingOutcomeEnum,
  meetingStatusEnum,
  meetingTypeEnum,
  msgDirectionEnum,
  msgSendModeEnum,
  msgStatusEnum,
  syncStatusEnum,
  templateChannelEnum,
} from './enums'

const id = () => uuid('id').primaryKey().defaultRandom()
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

/* ── Usuarios ──────────────────────────────────────────────────────────────
   1–3 personas, sin registro público. Se crean con `npm run user:create`.   */

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`)])

/* ── Cuentas emisoras ─────────────────────────────────────────────────────
   Las 10 de WhatsApp y las de Instagram. Es lo único que se carga a mano.   */

export const messagingAccounts = pgTable('messaging_accounts', {
  id: id(),
  /** Código corto para hacer match desde la columna `cuenta` del Excel: 'WA-01'. */
  code: text('code').notNull(),
  /** Nombre visible: 'WA-01 Ventas', 'IG @minegocio'. */
  label: text('label').notNull(),
  channel: channelEnum('channel').notNull(),
  /** Solo WhatsApp. E.164 sin '+'. */
  phoneE164: text('phone_e164'),
  /** Solo Instagram, en minúsculas y sin '@'. */
  igUsername: text('ig_username'),
  /** Nombre de la instancia en Evolution API. Se usa recién en la parte 2. */
  instanceName: text('instance_name'),
  mode: accountModeEnum('mode').notNull().default('manual'),
  status: accountStatusEnum('status').notNull().default('esperando_preparacion'),
  /** Mensajes por día permitidos una vez que la cuenta está activa. */
  dailyCap: smallint('daily_cap').notNull().default(30),
  /** Segundos mínimos entre dos envíos de la misma cuenta. */
  minGapSeconds: integer('min_gap_seconds').notNull().default(240),
  windowStart: time('window_start').notNull().default('09:00'),
  windowEnd: time('window_end').notNull().default('20:00'),

  /**
   * Caché de presentación y ordenamiento. NO es la autoridad del cupo: la
   * autoridad es `messages`, y se recuenta dentro de la transacción de reserva.
   */
  sentToday: integer('sent_today').notNull().default(0),
  counterDate: date('counter_date'),
  /** Último envío confirmado. Ordena la rotación y aplica la espera mínima. */
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }),

  /*
   * Calentamiento. Cuenta días de USO, no del almanaque: si el número no mandó
   * el martes, el miércoles sigue en el mismo día.
   */
  warmupDay: smallint('warmup_day'),
  warmupStartedOn: date('warmup_started_on'),
  warmupLastAdvancedOn: date('warmup_last_advanced_on'),
  /** Cuántas veces repitió el día actual por problemas. A la tercera, pausa. */
  warmupRepeats: smallint('warmup_repeats').notNull().default(0),

  /** Fallos seguidos. A los 3, la cuenta se bloquea sola. */
  consecutiveFailures: smallint('consecutive_failures').notNull().default(0),

  /** En qué sesión hay que estar para usarla: 'Chrome perfil 3'. Solo Instagram. */
  sessionHint: text('session_hint'),

  /**
   * Inbox de Chatwoot que corresponde a esta cuenta, uno por instancia.
   * Sin esto mapeado, la cuenta no puede enviar: el mensaje iría por el número
   * equivocado.
   */
  chatwootInboxId: integer('chatwoot_inbox_id'),

  /** Checklist previo. Mientras no esté completo, la cuenta no entra al reparto. */
  prepChecklist: jsonb('prep_checklist').notNull().default(sql`'{}'::jsonb`),

  /** Token de la instancia, cifrado con AES-256-GCM. Nunca sale del servidor. */
  instanceTokenEncrypted: text('instance_token_encrypted'),

  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('accounts_code_uq').on(sql`upper(${t.code})`),
  uniqueIndex('accounts_phone_uq').on(t.phoneE164).where(sql`${t.phoneE164} is not null`),
  uniqueIndex('accounts_ig_uq').on(t.igUsername).where(sql`${t.igUsername} is not null`),
  index('accounts_channel_status_idx').on(t.channel, t.status),
  // Índice de la consulta de rotación: menos usada hoy, y a igualdad la que hace
  // más tiempo que no envía.
  index('accounts_rotacion_idx')
    .on(t.channel, t.sentToday, t.lastSentAt)
    .where(sql`${t.status} in ('activa', 'calentando')`),
  check(
    'account_identity',
    sql`(${t.channel} = 'whatsapp' and ${t.phoneE164} is not null and ${t.igUsername} is null)
     or (${t.channel} = 'instagram' and ${t.igUsername} is not null and ${t.phoneE164} is null)`,
  ),
  check('account_caps', sql`${t.dailyCap} between 0 and 500 and ${t.minGapSeconds} >= 0`),
  check('account_warmup_day', sql`${t.warmupDay} is null or ${t.warmupDay} between 1 and 30`),
])

/* ── Lotes de importación ─────────────────────────────────────────────────*/

export const importBatches = pgTable('import_batches', {
  id: id(),
  filename: text('filename').notNull(),
  rowCount: integer('row_count').notNull().default(0),
  imported: integer('imported').notNull().default(0),
  updatedRows: integer('updated_rows').notNull().default(0),
  duplicates: integer('duplicates').notNull().default(0),
  needsReview: integer('needs_review').notNull().default(0),
  errors: integer('errors').notNull().default(0),
  /** Mapeo columna-de-Excel → campo, para proponerlo en la próxima importación. */
  columnMap: jsonb('column_map_jsonb').notNull().default(sql`'{}'::jsonb`),
  undoneAt: timestamp('undone_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [index('import_batches_created_idx').on(t.createdAt)])

/* ── Contactos ────────────────────────────────────────────────────────────
   Un contacto = un negocio, con los canales que tenga. Nunca uno por canal.  */

export const contacts = pgTable('contacts', {
  id: id(),
  businessName: text('business_name').notNull(),
  contactName: text('contact_name'),

  /** Lo que vino en el Excel, sin tocar. Se conserva para poder auditar el parseo. */
  phoneRaw: text('phone_raw'),
  /** E.164 sin '+': '5493834567890'. */
  phoneE164: text('phone_e164'),
  /**
   * Formato de teléfono válido y normalizable. NO significa "tiene WhatsApp":
   * en Argentina un fijo y un celular son indistinguibles por el número.
   * La verificación real se hace en la parte 2 y se marca en `waVerifiedAt`.
   */
  hasWhatsapp: boolean('has_whatsapp').notNull().default(false),
  waVerifiedAt: timestamp('wa_verified_at', { withTimezone: true }),

  igUsername: text('ig_username'),
  hasInstagram: boolean('has_instagram').notNull().default(false),

  niche: text('niche'),
  /** Qué me compró antes. Alimenta la variable {{compro}} de las plantillas. */
  bought: text('bought'),
  city: text('city'),
  notes: text('notes'),

  stage: contactStageEnum('stage').notNull().default('nuevo'),
  score: smallint('score').notNull().default(0),
  /** El cálculo del score, renglón por renglón. Es lo que se ve al pasar el mouse. */
  scoreBreakdown: jsonb('score_breakdown').notNull().default(sql`'[]'::jsonb`),

  /** Calculado: whatsapp si hay teléfono válido, si no instagram. */
  preferredChannel: channelEnum('preferred_channel'),
  /** Si está en true, el canal fue forzado a mano y el cálculo no lo pisa. */
  preferredChannelLocked: boolean('preferred_channel_locked').notNull().default(false),

  /**
   * Asignación pegada: se decide una vez y no se mueve.
   * Un contacto con los dos canales tiene cuenta de WhatsApp Y cuenta de Instagram.
   */
  assignedWaAccountId: uuid('assigned_wa_account_id').references(() => messagingAccounts.id, {
    onDelete: 'set null',
  }),
  assignedIgAccountId: uuid('assigned_ig_account_id').references(() => messagingAccounts.id, {
    onDelete: 'set null',
  }),

  sentCount: integer('sent_count').notNull().default(0),
  receivedCount: integer('received_count').notNull().default(0),
  threadCount: integer('thread_count').notNull().default(0),
  sequenceStep: smallint('sequence_step').notNull().default(0),

  lastOutboundAt: timestamp('last_outbound_at', { withTimezone: true }),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  firstRepliedAt: timestamp('first_replied_at', { withTimezone: true }),
  nextFollowupAt: timestamp('next_followup_at', { withTimezone: true }),
  discardedAt: timestamp('discarded_at', { withTimezone: true }),

  /** Espejo del contacto en Chatwoot, para poder abrir la conversación en un click. */
  chatwootContactId: integer('chatwoot_contact_id'),
  chatwootConversationId: integer('chatwoot_conversation_id'),

  importBatchId: uuid('import_batch_id').references(() => importBatches.id, { onDelete: 'set null' }),
  dedupeKey: text('dedupe_key').notNull(),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('contacts_dedupe_key_uq').on(t.dedupeKey),
  // Unicidad real por canal: evita que el mismo negocio entre dos veces cuando
  // un import trae solo Instagram y el siguiente trae teléfono + Instagram.
  uniqueIndex('contacts_phone_uq').on(t.phoneE164).where(sql`${t.phoneE164} is not null`),
  uniqueIndex('contacts_ig_uq').on(sql`lower(${t.igUsername})`).where(sql`${t.igUsername} is not null`),
  index('contacts_stage_idx').on(t.stage),
  index('contacts_followup_idx')
    .on(t.nextFollowupAt)
    .where(sql`${t.nextFollowupAt} is not null and ${t.discardedAt} is null`),
  index('contacts_wa_account_idx').on(t.assignedWaAccountId).where(sql`${t.assignedWaAccountId} is not null`),
  index('contacts_ig_account_idx').on(t.assignedIgAccountId).where(sql`${t.assignedIgAccountId} is not null`),
  index('contacts_batch_idx').on(t.importBatchId),
  index('contacts_niche_idx').on(t.niche),
  index('contacts_city_idx').on(t.city),
  index('contacts_search_trgm').using(
    'gin',
    sql`(coalesce(${t.businessName}, '') || ' ' || coalesce(${t.contactName}, '') || ' ' ||
         coalesce(${t.phoneE164}, '') || ' ' || coalesce(${t.igUsername}, '')) gin_trgm_ops`,
  ),
  check('contact_has_channel', sql`${t.phoneE164} is not null or ${t.igUsername} is not null`),
  check('contact_score_range', sql`${t.score} between 0 and 100`),
])

/* ── Detalle fila por fila de cada importación ────────────────────────────
   Alimenta la pestaña "Revisar" y hace posible deshacer una actualización.  */

export const importBatchItems = pgTable('import_batch_items', {
  id: id(),
  batchId: uuid('batch_id')
    .notNull()
    .references(() => importBatches.id, { onDelete: 'cascade' }),
  rowNumber: integer('row_number').notNull(),
  action: importActionEnum('action').notNull(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  /** Motivo legible: 'teléfono inválido', 'la cuenta WA-99 no existe'. */
  reason: text('reason'),
  /** La fila cruda del Excel, tal cual se leyó. */
  raw: jsonb('raw_jsonb').notNull(),
  /** Estado anterior del contacto, para revertir un 'actualizado'. */
  previous: jsonb('previous_jsonb'),
  createdAt: createdAt(),
}, (t) => [
  index('import_items_batch_action_idx').on(t.batchId, t.action),
  index('import_items_contact_idx').on(t.contactId),
])

/* ── Plantillas ───────────────────────────────────────────────────────────*/

export const templates = pgTable('templates', {
  id: id(),
  name: text('name').notNull(),
  channel: templateChannelEnum('channel').notNull().default('ambos'),
  /** null = plantilla general; si hay una del rubro del contacto, gana esa. */
  niche: text('niche'),
  sequenceStep: smallint('sequence_step'),
  /** Cuerpo con {{variables}}. */
  body: text('body').notNull(),
  /** 2–4 redacciones equivalentes que rotan entre contactos. */
  variants: jsonb('variants').notNull().default(sql`'[]'::jsonb`),
  active: boolean('active').notNull().default(true),

  /**
   * Plantilla de apertura: el primer mensaje a un contacto que todavía no
   * recibió nada. Son las únicas que exigen piloto antes de escalar.
   */
  isOpening: boolean('is_opening').notNull().default(false),
  /** 'sin_piloto' | 'en_curso' | 'aprobada' | 'bloqueada' */
  pilotStatus: text('pilot_status').notNull().default('sin_piloto'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('templates_lookup_idx').on(t.channel, t.niche, t.sequenceStep).where(sql`${t.active}`),
])

/* ── Tandas piloto ────────────────────────────────────────────────────────
   Una plantilla de apertura nueva solo puede salir por UN número hasta que su
   tanda se complete, pasen 24 h y yo la apruebe.                            */

export const pilots = pgTable('pilots', {
  id: id(),
  templateId: uuid('template_id')
    .notNull()
    .references(() => templates.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id')
    .notNull()
    .references(() => messagingAccounts.id, { onDelete: 'cascade' }),
  /** Tamaño de la tanda. Por defecto el cupo de la cuenta. */
  targetSize: smallint('target_size').notNull().default(30),
  /** El filtro con el que se sorteó la muestra, para poder auditarla. */
  filters: jsonb('filters_jsonb').notNull().default(sql`'{}'::jsonb`),
  /** 'en_curso' | 'esperando' | 'aprobado' | 'bloqueado' | 'forzado' | 'cancelado' */
  status: text('status').notNull().default('en_curso'),
  /** Umbrales con los que se evaluó esta tanda, congelados al crearla. */
  thresholds: jsonb('thresholds_jsonb').notNull().default(sql`'{}'::jsonb`),
  /** Último envío de la tanda: arranca acá la ventana de 24 h. */
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  /** Texto que escribí a mano si forcé un escalado en rojo. */
  forceReason: text('force_reason'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [
  index('pilots_template_idx').on(t.templateId, sql`${t.createdAt} desc`),
  // Una plantilla no puede tener dos pilotos abiertos a la vez.
  uniqueIndex('pilots_abierto_uq')
    .on(t.templateId)
    .where(sql`${t.status} in ('en_curso', 'esperando')`),
])

/* ── Estado del bloque de Instagram ───────────────────────────────────────
   Instagram se trabaja en bloques de una cuenta por vez. Esto guarda cuál está
   activa para poder retomar donde quedé si cierro el navegador.             */

export const igDispatchState = pgTable('ig_dispatch_state', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  activeAccountId: uuid('active_account_id').references(() => messagingAccounts.id, {
    onDelete: 'set null',
  }),
  blockStartedAt: timestamp('block_started_at', { withTimezone: true }),
  updatedAt: updatedAt(),
})

/* ── Secuencia de seguimiento ─────────────────────────────────────────────*/

export const sequenceSteps = pgTable('sequence_steps', {
  id: id(),
  stepNumber: smallint('step_number').notNull(),
  name: text('name').notNull(),
  /** Días desde el mensaje anterior. */
  delayDays: smallint('delay_days').notNull(),
  templateId: uuid('template_id').references(() => templates.id, { onDelete: 'set null' }),
  channelPreference: templateChannelEnum('channel_preference').notNull().default('ambos'),
  /** Siempre true: si contestó, la secuencia se corta. */
  stopOnReply: boolean('stop_on_reply').notNull().default(true),
  active: boolean('active').notNull().default(true),
}, (t) => [uniqueIndex('sequence_steps_number_uq').on(t.stepNumber)])

/* ── Mensajes ─────────────────────────────────────────────────────────────*/

export const messages = pgTable('messages', {
  id: id(),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').references(() => messagingAccounts.id, { onDelete: 'set null' }),
  channel: channelEnum('channel').notNull(),
  direction: msgDirectionEnum('direction').notNull(),
  body: text('body'),
  templateId: uuid('template_id').references(() => templates.id, { onDelete: 'set null' }),
  /** Índice de la variante usada, para medir qué redacción responde mejor. */
  templateVariant: smallint('template_variant'),
  sequenceStep: smallint('sequence_step'),
  status: msgStatusEnum('status').notNull().default('encolado'),
  sendMode: msgSendModeEnum('send_mode').notNull().default('manual'),
  /** Id del mensaje en Evolution API. */
  externalId: text('external_id'),

  /**
   * Id del mensaje en Chatwoot. Único: Chatwoot reintenta los webhooks, y sin
   * esto un reintento duplicaría el mensaje y el consumo de cupo.
   */
  chatwootMessageId: integer('chatwoot_message_id'),
  syncStatus: syncStatusEnum('sync_status').notNull().default('ok'),
  failReason: text('fail_reason'),
  /** Por qué se marcó 'saltado'. Ej: 'falta {{compro}}'. */
  skipReason: text('skip_reason'),

  /**
   * `contacto:paso:fechaOperativa`. Único en la base: un reintento de red, un
   * doble click o un reenvío de webhook chocan contra el índice y no crean un
   * segundo mensaje ni consumen cupo dos veces.
   */
  idempotencyKey: text('idempotency_key'),

  /**
   * Deshacer sella esta fecha en vez de borrar. El recuento de cupo excluye los
   * deshechos, así que el cupo se libera solo, sin decrementar nada a mano.
   */
  undoneAt: timestamp('undone_at', { withTimezone: true }),

  /** Si el mensaje salió como parte de una tanda piloto. */
  pilotId: uuid('pilot_id'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  /** Cuándo se abrió el canal en modo semi-automático. */
  openedAt: timestamp('opened_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index('messages_contact_idx').on(t.contactId, sql`${t.createdAt} desc`),
  index('messages_status_idx').on(t.status),
  uniqueIndex('messages_external_uq').on(t.externalId).where(sql`${t.externalId} is not null`),
  uniqueIndex('messages_idempotency_uq')
    .on(t.idempotencyKey)
    .where(sql`${t.idempotencyKey} is not null`),
  /*
   * Índice del recuento de cupo. La transacción de reserva filtra por
   * account_id + rango de sent_at (precalculado en UTC, no AT TIME ZONE sobre
   * la columna, que no sería sargable) y por los estados que consumen cupo.
   */
  index('messages_cupo_idx')
    .on(t.accountId, t.sentAt)
    .where(
      sql`${t.status} in ('enviado','entregado','leido','respondido') and ${t.undoneAt} is null`,
    ),
  index('messages_account_idx').on(t.accountId, sql`${t.sentAt} desc`),
  index('messages_pilot_idx').on(t.pilotId).where(sql`${t.pilotId} is not null`),
  uniqueIndex('messages_chatwoot_uq')
    .on(t.chatwootMessageId)
    .where(sql`${t.chatwootMessageId} is not null`),
  index('messages_sync_idx')
    .on(t.syncStatus)
    .where(sql`${t.syncStatus} <> 'ok'`),
])

/* ── Chatwoot ─────────────────────────────────────────────────────────────
   Chatwoot es la bandeja; la consola es el cerebro. Una sola fila: es una
   instalación por despliegue.                                              */

export const chatwootConfig = pgTable('chatwoot_config', {
  id: smallint('id').primaryKey().default(1),
  baseUrl: text('base_url').notNull(),
  accountId: integer('account_id').notNull(),
  /** Token de la API, cifrado con AES-256-GCM. Nunca sale del servidor. */
  apiTokenEncrypted: text('api_token_encrypted').notNull(),
  /** Con esto se valida la firma de cada webhook entrante. */
  webhookSecret: text('webhook_secret').notNull(),
  active: boolean('active').notNull().default(true),
  /**
   * Último webhook recibido. Alimenta el indicador de sincronización: si esto
   * queda viejo habiendo mensajes enviados, la consola cree que nadie contestó
   * y sigue mandando seguimientos a gente que ya respondió.
   */
  lastWebhookAt: timestamp('last_webhook_at', { withTimezone: true }),
  updatedAt: updatedAt(),
}, (t) => [check('chatwoot_config_fila_unica', sql`${t.id} = 1`)])

/* ── Reuniones ────────────────────────────────────────────────────────────*/

export const meetings = pgTable('meetings', {
  id: id(),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  durationMinutes: smallint('duration_minutes').notNull().default(30),
  type: meetingTypeEnum('type').notNull().default('llamada'),
  locationOrLink: text('location_or_link'),
  agenda: text('agenda'),
  notes: text('notes'),
  status: meetingStatusEnum('status').notNull().default('agendada'),
  outcome: meetingOutcomeEnum('outcome'),
  reminderAt: timestamp('reminder_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index('meetings_scheduled_idx').on(t.scheduledAt),
  index('meetings_contact_idx').on(t.contactId, sql`${t.scheduledAt} desc`),
])

/* ── Bitácora ─────────────────────────────────────────────────────────────*/

export const events = pgTable('events', {
  id: id(),
  type: text('type').notNull(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').references(() => messagingAccounts.id, { onDelete: 'set null' }),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  payload: jsonb('payload_jsonb').notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
}, (t) => [
  index('events_contact_idx').on(t.contactId, sql`${t.createdAt} desc`),
  index('events_type_idx').on(t.type, sql`${t.createdAt} desc`),
])

/* ── Vistas guardadas y configuración global ──────────────────────────────*/

export const savedViews = pgTable('saved_views', {
  id: id(),
  name: text('name').notNull(),
  filters: jsonb('filters_jsonb').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
})

/** Clave-valor para {{mi_nombre}}, {{oferta}} y la zona horaria operativa. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value_jsonb').notNull(),
  updatedAt: updatedAt(),
})

/* ── Relaciones ───────────────────────────────────────────────────────────*/

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  waAccount: one(messagingAccounts, {
    fields: [contacts.assignedWaAccountId],
    references: [messagingAccounts.id],
    relationName: 'waAccount',
  }),
  igAccount: one(messagingAccounts, {
    fields: [contacts.assignedIgAccountId],
    references: [messagingAccounts.id],
    relationName: 'igAccount',
  }),
  importBatch: one(importBatches, {
    fields: [contacts.importBatchId],
    references: [importBatches.id],
  }),
  messages: many(messages),
  meetings: many(meetings),
  events: many(events),
}))

export const messagesRelations = relations(messages, ({ one }) => ({
  contact: one(contacts, { fields: [messages.contactId], references: [contacts.id] }),
  account: one(messagingAccounts, { fields: [messages.accountId], references: [messagingAccounts.id] }),
  template: one(templates, { fields: [messages.templateId], references: [templates.id] }),
}))

export const meetingsRelations = relations(meetings, ({ one }) => ({
  contact: one(contacts, { fields: [meetings.contactId], references: [contacts.id] }),
}))

export const eventsRelations = relations(events, ({ one }) => ({
  contact: one(contacts, { fields: [events.contactId], references: [contacts.id] }),
  account: one(messagingAccounts, { fields: [events.accountId], references: [messagingAccounts.id] }),
  actor: one(users, { fields: [events.actorUserId], references: [users.id] }),
}))

export const importBatchItemsRelations = relations(importBatchItems, ({ one }) => ({
  batch: one(importBatches, { fields: [importBatchItems.batchId], references: [importBatches.id] }),
  contact: one(contacts, { fields: [importBatchItems.contactId], references: [contacts.id] }),
}))

export type Contact = typeof contacts.$inferSelect
export type NewContact = typeof contacts.$inferInsert
export type MessagingAccount = typeof messagingAccounts.$inferSelect
export type NewMessagingAccount = typeof messagingAccounts.$inferInsert
export type Template = typeof templates.$inferSelect
export type Message = typeof messages.$inferSelect
export type Meeting = typeof meetings.$inferSelect
export type ImportBatch = typeof importBatches.$inferSelect
export type ImportBatchItem = typeof importBatchItems.$inferSelect
export type AppUser = typeof users.$inferSelect

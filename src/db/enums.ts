import { pgEnum } from 'drizzle-orm/pg-core'

/**
 * Los valores de los enums son la fuente de verdad compartida entre la base y la UI.
 * Están en español porque son los que se muestran en pantalla sin traducir.
 */

export const CHANNELS = ['whatsapp', 'instagram'] as const
export const channelEnum = pgEnum('channel', CHANNELS)
export type Channel = (typeof CHANNELS)[number]

export const TEMPLATE_CHANNELS = ['whatsapp', 'instagram', 'ambos'] as const
export const templateChannelEnum = pgEnum('template_channel', TEMPLATE_CHANNELS)
export type TemplateChannel = (typeof TEMPLATE_CHANNELS)[number]

/** 'api' = el servidor manda solo. 'manual' = semi-automático, abro el chat y confirmo. */
export const ACCOUNT_MODES = ['api', 'manual'] as const
export const accountModeEnum = pgEnum('account_mode', ACCOUNT_MODES)
export type AccountMode = (typeof ACCOUNT_MODES)[number]

/**
 * Por dónde salió cada mensaje. Es distinto del modo de la cuenta porque un
 * mismo número puede haber mandado por las cuatro vías el mismo día, y cada una
 * se trata distinto al conciliar.
 */
export const MSG_SEND_MODES = ['manual', 'chatwoot', 'evolution', 'chatwoot_agente'] as const
export const msgSendModeEnum = pgEnum('msg_send_mode', MSG_SEND_MODES)
export type MsgSendMode = (typeof MSG_SEND_MODES)[number]

export const SEND_MODE_META: Record<MsgSendMode, { label: string; detalle: string }> = {
  manual: {
    label: 'Manual',
    detalle: 'Abrí el chat desde la consola y confirmé que lo mandé.',
  },
  chatwoot: {
    label: 'Chatwoot',
    detalle: 'Lo mandó la consola por la API de Chatwoot.',
  },
  evolution: {
    label: 'Evolution',
    detalle: 'Respaldo: Chatwoot no respondía y salió directo por Evolution.',
  },
  chatwoot_agente: {
    label: 'A mano en Chatwoot',
    detalle: 'Lo escribí yo dentro de Chatwoot. Llegó por webhook y consume cupo.',
  },
}

/** Estado de sincronización de un mensaje contra Chatwoot. */
export const SYNC_STATUSES = ['ok', 'sin_sincronizar', 'duplicado_descartado'] as const
export const syncStatusEnum = pgEnum('sync_status', SYNC_STATUSES)
export type SyncStatus = (typeof SYNC_STATUSES)[number]

/**
 * 'esperando_preparacion': el checklist previo (perfil, antigüedad, tráfico real)
 * no está completo. La cuenta existe pero no entra al reparto.
 * 'esperando_piloto' NO es un estado de cuenta: es una relación entre cuenta y
 * plantilla, y sale del estado del piloto correspondiente.
 */
export const ACCOUNT_STATUSES = [
  'esperando_preparacion',
  'calentando',
  'activa',
  'pausada',
  'bloqueada',
] as const
export const accountStatusEnum = pgEnum('account_status', ACCOUNT_STATUSES)
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

/** Estados desde los que una cuenta puede enviar. */
export const ESTADOS_OPERATIVOS = ['activa', 'calentando'] as const

export function esOperativa(status: AccountStatus): boolean {
  return status === 'activa' || status === 'calentando'
}

export const MSG_DIRECTIONS = ['out', 'in'] as const
export const msgDirectionEnum = pgEnum('msg_direction', MSG_DIRECTIONS)
export type MsgDirection = (typeof MSG_DIRECTIONS)[number]

export const MSG_STATUSES = [
  'encolado',
  'abierto',
  'enviado',
  'entregado',
  'leido',
  'respondido',
  'fallido',
  'saltado',
] as const
export const msgStatusEnum = pgEnum('msg_status', MSG_STATUSES)
export type MsgStatus = (typeof MSG_STATUSES)[number]

export const MEETING_TYPES = ['llamada', 'videollamada', 'presencial'] as const
export const meetingTypeEnum = pgEnum('meeting_type', MEETING_TYPES)
export type MeetingType = (typeof MEETING_TYPES)[number]

export const MEETING_STATUSES = [
  'agendada',
  'confirmada',
  'hecha',
  'no_asistio',
  'reprogramada',
  'cancelada',
] as const
export const meetingStatusEnum = pgEnum('meeting_status', MEETING_STATUSES)
export type MeetingStatus = (typeof MEETING_STATUSES)[number]

export const MEETING_OUTCOMES = ['cerro', 'seguimiento', 'no'] as const
export const meetingOutcomeEnum = pgEnum('meeting_outcome', MEETING_OUTCOMES)
export type MeetingOutcome = (typeof MEETING_OUTCOMES)[number]

export const IMPORT_ACTIONS = ['insertado', 'actualizado', 'duplicado', 'revisar', 'error'] as const
export const importActionEnum = pgEnum('import_action', IMPORT_ACTIONS)
export type ImportAction = (typeof IMPORT_ACTIONS)[number]

/**
 * Etapas del embudo. Provisorias hasta que se confirme la lista definitiva:
 * cambiarlas después cuesta una migración de enum, así que están centralizadas acá.
 */
export const CONTACT_STAGES = [
  // Carril de salida: avanza solo con cada mensaje enviado de la secuencia.
  'nuevo',
  'encolado',
  'contactado',
  'seguimiento_1',
  'seguimiento_2',
  'seguimiento_3',
  // Carril de respuesta: se entra en cualquier punto, y corta la secuencia.
  'respondido',
  'interesado',
  'reunion_agendada',
  'cerrado',
  // Salidas.
  'perdido',
  'sin_respuesta',
  'no_contactar',
  'descartado',
] as const
export const contactStageEnum = pgEnum('contact_stage', CONTACT_STAGES)
export type ContactStage = (typeof CONTACT_STAGES)[number]

/** Etapas desde las que un contacto ya no vuelve a la cola de envío. */
export const ETAPAS_TERMINALES: readonly ContactStage[] = [
  'cerrado',
  'perdido',
  'no_contactar',
  'descartado',
]

/** Etapas del carril de salida, en orden. La secuencia avanza por acá. */
export const ETAPAS_SECUENCIA: readonly ContactStage[] = [
  'contactado',
  'seguimiento_1',
  'seguimiento_2',
  'seguimiento_3',
]

/** Etapa que corresponde al paso N de la secuencia (1..4). */
export function etapaDePaso(paso: number): ContactStage {
  return ETAPAS_SECUENCIA[Math.min(Math.max(paso, 1), ETAPAS_SECUENCIA.length) - 1] ?? 'contactado'
}

/** Etiquetas y color semántico de cada etapa, para no repetirlo en cada vista. */
export const STAGE_META: Record<
  ContactStage,
  { label: string; tone: 'neutral' | 'activo' | 'positivo' | 'negativo' }
> = {
  nuevo: { label: 'Nuevo', tone: 'neutral' },
  encolado: { label: 'Encolado', tone: 'activo' },
  contactado: { label: 'Contactado', tone: 'activo' },
  seguimiento_1: { label: 'Seguimiento 1', tone: 'activo' },
  seguimiento_2: { label: 'Seguimiento 2', tone: 'activo' },
  seguimiento_3: { label: 'Seguimiento 3', tone: 'activo' },
  respondido: { label: 'Respondió', tone: 'positivo' },
  interesado: { label: 'Interesado', tone: 'positivo' },
  reunion_agendada: { label: 'Reunión agendada', tone: 'positivo' },
  cerrado: { label: 'Cerrado', tone: 'positivo' },
  perdido: { label: 'Perdido', tone: 'negativo' },
  sin_respuesta: { label: 'Sin respuesta', tone: 'neutral' },
  no_contactar: { label: 'No contactar', tone: 'negativo' },
  descartado: { label: 'Descartado', tone: 'negativo' },
}

export const ACCOUNT_STATUS_META: Record<
  AccountStatus,
  { label: string; tone: 'positivo' | 'neutral' | 'activo' | 'negativo' }
> = {
  esperando_preparacion: { label: 'Esperando preparación', tone: 'neutral' },
  calentando: { label: 'Calentando', tone: 'activo' },
  activa: { label: 'Activa', tone: 'positivo' },
  pausada: { label: 'Pausada', tone: 'neutral' },
  bloqueada: { label: 'Bloqueada', tone: 'negativo' },
}

/** Semáforo de salud del número. El motivo se calcula junto al color. */
export const SALUD = ['verde', 'amarillo', 'rojo'] as const
export type Salud = (typeof SALUD)[number]

/** Tipos de evento que se registran en la bitácora. */
export const EVENT_TYPES = [
  'contacto_importado',
  'contacto_actualizado',
  'contacto_asignado',
  'contacto_reasignado',
  'contacto_descartado',
  'etapa_cambiada',
  'mensaje_encolado',
  'mensaje_abierto',
  'mensaje_enviado',
  'mensaje_saltado',
  'respuesta_recibida',
  'reunion_agendada',
  'reunion_hecha',
  'cuenta_creada',
  'cuenta_editada',
  'cuenta_pausada',
  'cuenta_bloqueada',
  'cap_alcanzado',
  'importacion_deshecha',
  // Parte 2: rotación, calentamiento y contabilidad.
  'cupo_corregido',
  'envio_reservado',
  'envio_deshecho',
  'envio_fallido',
  'calentamiento_iniciado',
  'calentamiento_avanzo',
  'calentamiento_repitio',
  'calentamiento_terminado',
  'calentamiento_salteado',
  'preparacion_completada',
  'salud_cambio',
  // Chatwoot.
  'chatwoot_webhook_recibido',
  'chatwoot_saliente_a_mano',
  'chatwoot_duplicado_descartado',
  'chatwoot_caido',
  'chatwoot_recuperado',
  'envio_sin_sincronizar',
  'seguimientos_bloqueados',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

/**
 * Motivos por los que una reserva de cupo puede rechazarse. Son los que ve el
 * Despachador, así que el texto es el que se muestra.
 */
export const MOTIVOS_RECHAZO = {
  cupo: 'La cuenta llegó a su cupo de hoy.',
  espera: 'Todavía no pasó la espera mínima de esta cuenta.',
  ventana: 'Está fuera de la ventana horaria de envío.',
  domingo: 'Los domingos no se envía.',
  no_operativa: 'La cuenta no está en condiciones de enviar.',
  duplicado: 'Ese mensaje ya se había enviado.',
  sin_cuenta: 'No hay ninguna cuenta disponible para este contacto.',
} as const
export type MotivoRechazo = keyof typeof MOTIVOS_RECHAZO

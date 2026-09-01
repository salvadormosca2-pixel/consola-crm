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
export type EventType = (typeof EVENT_TYPES)[number] | (typeof EVENT_TYPES_SETTERS)[number]

/* ── Módulo de setters ─────────────────────────────────────────────────── */

/**
 * Quién es cada persona que entra.
 *
 *   admin_madre  yo. Ve todo, crea y borra cuentas, ve las credenciales.
 *                Protegida a nivel base: no se puede borrar ni degradar.
 *   admin        todo lo operativo. Sin credenciales, sin crear admins.
 *   setter       solo su cola, sus leads, sus avisos y sus números.
 */
export const USER_ROLES = ['admin_madre', 'admin', 'setter'] as const
export const userRoleEnum = pgEnum('user_role', USER_ROLES)
export type UserRole = (typeof USER_ROLES)[number]

export const ROL_META: Record<UserRole, { label: string; detalle: string }> = {
  admin_madre: {
    label: 'Admin madre',
    detalle: 'Ve todo, incluidas las credenciales. Es la única que crea y borra cuentas.',
  },
  admin: {
    label: 'Admin',
    detalle: 'Todo lo operativo: leads, setters, bandeja, reuniones y recordatorios.',
  },
  setter: {
    label: 'Setter',
    detalle: 'Su cola del día, sus leads y sus avisos. No ve la base ni a los demás.',
  },
}

/** Los dos roles que entran al panel. */
export const ROLES_ADMIN: readonly UserRole[] = ['admin_madre', 'admin']

export function esAdmin(rol: UserRole | null | undefined): boolean {
  return rol === 'admin_madre' || rol === 'admin'
}

/**
 * 'pausado': no puede entrar, pero conserva historial y comisión.
 * 'baja': no puede entrar, sus leads sin contactar vuelven al pozo, y el
 * registro se desactiva en lugar de borrarse para poder liquidar lo trabajado.
 */
export const USER_STATUSES = ['activo', 'pausado', 'baja'] as const
export const userStatusEnum = pgEnum('user_status', USER_STATUSES)
export type UserStatus = (typeof USER_STATUSES)[number]

export const USER_STATUS_META: Record<UserStatus, { label: string; tone: Tono }> = {
  activo: { label: 'Activo', tone: 'positivo' },
  pausado: { label: 'Pausado', tone: 'neutral' },
  baja: { label: 'De baja', tone: 'negativo' },
}

/** Igual que el `Tono` de la UI, replicado acá para no importar componentes. */
type Tono = 'neutral' | 'activo' | 'positivo' | 'negativo'

export const LEAD_ESTADOS = [
  'asignado',
  'abierto',
  'saltado',
  'contactado',
  'segundo_enviado',
  'respondido',
  'cuenta_inexistente',
  'vencido',
  'devuelto',
] as const
export const leadAssignmentEstadoEnum = pgEnum('lead_assignment_estado', LEAD_ESTADOS)
export type LeadEstado = (typeof LEAD_ESTADOS)[number]

export const LEAD_ESTADO_META: Record<LeadEstado, { label: string; tone: Tono }> = {
  asignado: { label: 'Por contactar', tone: 'neutral' },
  abierto: { label: 'Chat abierto', tone: 'activo' },
  saltado: { label: 'Salteado', tone: 'neutral' },
  contactado: { label: 'Contactado', tone: 'activo' },
  segundo_enviado: { label: 'Segundo enviado', tone: 'activo' },
  respondido: { label: 'Respondió', tone: 'positivo' },
  cuenta_inexistente: { label: 'Cuenta inexistente', tone: 'negativo' },
  vencido: { label: 'Vencido', tone: 'negativo' },
  devuelto: { label: 'Devuelto al pozo', tone: 'neutral' },
}

/**
 * Estados en los que el lead sigue tomado por el setter. Solo 'vencido' y
 * 'devuelto' quedan afuera, y son exactamente los que devuelven el lead al pozo.
 */
export const ESTADOS_TOMADOS: readonly LeadEstado[] = [
  'asignado',
  'abierto',
  'saltado',
  'contactado',
  'segundo_enviado',
  'respondido',
  'cuenta_inexistente',
]

/** Estados que todavía esperan una acción del setter dentro de su cola. */
export const ESTADOS_EN_COLA: readonly LeadEstado[] = ['asignado', 'abierto', 'saltado']

/** Estados que cuentan el lead como no trabajado a efectos del vencimiento. */
export const ESTADOS_SIN_TRABAJAR: readonly LeadEstado[] = ['asignado', 'abierto', 'saltado']

/**
 * Los dos mensajes, que hacen cosas distintas:
 *
 *   primero  el gancho. No dice a qué nos dedicamos, solo abre conversación.
 *   segundo  la oferta. Acá sí le contamos qué le estamos ofreciendo.
 */
export const SETTER_SEND_TIPOS = ['primero', 'segundo'] as const
export const setterSendTipoEnum = pgEnum('setter_send_tipo', SETTER_SEND_TIPOS)
export type SetterSendTipo = (typeof SETTER_SEND_TIPOS)[number]

export const MENSAJE_META: Record<SetterSendTipo, { label: string; detalle: string }> = {
  primero: {
    label: 'Primer mensaje',
    detalle: 'El de entrada. Abre conversación, no ofrece nada todavía.',
  },
  segundo: {
    label: 'Segundo mensaje',
    detalle: 'La oferta: qué hacemos y qué le proponemos.',
  },
}

/**
 * Qué contestó cuando ya vio la oferta.
 *
 * Solo existe para el segundo mensaje: un "me interesa" antes de saber qué le
 * estamos ofreciendo no significa nada.
 *
 * Son tres y no dos porque entre el sí y el no está el que más se pierde: el
 * que contestó con una duda. Tratarlo como un no lo cierra, y tratarlo como un
 * sí le manda un mensaje que no viene al caso.
 */
export const LEAD_INTERESES = ['interesa', 'no_interesa', 'tibio'] as const
export const leadInteresEnum = pgEnum('lead_interes', LEAD_INTERESES)
export type LeadInteres = (typeof LEAD_INTERESES)[number]

export const INTERES_META: Record<LeadInteres, { label: string; tone: Tono; detalle: string }> = {
  interesa: {
    label: 'Le interesa',
    detalle: 'Vio la oferta y dijo que sí. Es el mejor lead que hay: pasa primero.',
    tone: 'positivo',
  },
  no_interesa: {
    label: 'No le interesa',
    detalle: 'Vio la oferta y dijo que no. Sale de la cola, pero cuenta como respuesta.',
    tone: 'negativo',
  },
  tibio: {
    label: 'Tibio',
    detalle:
      'Contestó la oferta con una duda o una objeción: precio, momento, "después veo". Ni sí ni no, y es el que más se pierde por tratarlo como un no.',
    tone: 'activo',
  },
}

/**
 * Cómo se lee una respuesta según a qué mensaje llegó. Son dos hechos
 * distintos y se atienden distinto, por eso no comparten etiqueta.
 */
export const RESPUESTA_META: Record<SetterSendTipo, { label: string; detalle: string }> = {
  primero: {
    label: 'Respondió el 1er mensaje',
    detalle: 'Abrió conversación y todavía no sabe qué le ofrecemos. Entramos nosotros.',
  },
  segundo: {
    label: 'Respondió el 2do mensaje',
    detalle: 'Ya sabe qué le ofrecemos y contestó que sí o que no.',
  },
}

export const CONTACT_ORIGENES = ['cliente', 'scrapeado'] as const
export const contactOrigenEnum = pgEnum('contact_origen', CONTACT_ORIGENES)
export type ContactOrigen = (typeof CONTACT_ORIGENES)[number]

export const ORIGEN_META: Record<ContactOrigen, { label: string; detalle: string }> = {
  cliente: {
    label: 'Cliente propio',
    detalle: 'Gente que ya me conoce o me compró. La trabaja el Despachador.',
  },
  scrapeado: {
    label: 'Lead scrapeado',
    detalle: 'Contacto frío sacado de una lista. Lo trabaja el equipo de setters por Instagram.',
  },
}

export const NOTIFICACION_TIPOS = [
  'respondio',
  'reunion_agendada',
  'setter_inactivo',
  'leads_por_vencer',
  'seguimientos_atrasados',
  'cuenta_baja_respuesta',
  'mensaje_sin_leer',
  'respuesta_de_setter',
  'recordatorio',
] as const
export const notificacionTipoEnum = pgEnum('notificacion_tipo', NOTIFICACION_TIPOS)
export type NotificacionTipo = (typeof NOTIFICACION_TIPOS)[number]

export const NOTIFICACION_META: Record<NotificacionTipo, { label: string; tone: Tono }> = {
  respondio: { label: 'Respondió', tone: 'positivo' },
  reunion_agendada: { label: 'Reunión agendada', tone: 'positivo' },
  setter_inactivo: { label: 'Setter sin actividad', tone: 'negativo' },
  leads_por_vencer: { label: 'Leads por vencer', tone: 'activo' },
  seguimientos_atrasados: { label: 'Seguimientos atrasados', tone: 'negativo' },
  cuenta_baja_respuesta: { label: 'Cuenta con baja respuesta', tone: 'negativo' },
  mensaje_sin_leer: { label: 'Mensaje sin leer', tone: 'activo' },
  respuesta_de_setter: { label: 'Respuesta de un setter', tone: 'activo' },
  recordatorio: { label: 'Recordatorio', tone: 'activo' },
}

/**
 * Cuánto interrumpe un mensaje al equipo.
 *
 *   aviso       aparece en la campana y en la pestaña Avisos.
 *   importante  cartel al abrir la app, con "Entendido". Se puede cerrar.
 *   bloqueante  cartel que no se cierra sin confirmar. La cola no se habilita.
 */
export const MENSAJE_NIVELES = ['aviso', 'importante', 'bloqueante'] as const
export const mensajeEquipoNivelEnum = pgEnum('mensaje_equipo_nivel', MENSAJE_NIVELES)
export type MensajeNivel = (typeof MENSAJE_NIVELES)[number]

export const NIVEL_META: Record<MensajeNivel, { label: string; detalle: string; tone: Tono }> = {
  aviso: {
    label: 'Aviso',
    detalle: 'Le aparece en la campana y en su pestaña de avisos. No lo interrumpe.',
    tone: 'neutral',
  },
  importante: {
    label: 'Importante',
    detalle: 'Cartel al abrir la app. Lo cierra con "Entendido" y sigue trabajando.',
    tone: 'activo',
  },
  bloqueante: {
    label: 'Bloqueante',
    detalle: 'La cola no se habilita hasta que confirme que lo leyó. Para cambios de guion.',
    tone: 'negativo',
  },
}

export const RECORDATORIO_TIPOS = ['seguimientos', 'sin_contactar'] as const
export const recordatorioTipoEnum = pgEnum('recordatorio_tipo', RECORDATORIO_TIPOS)
export type RecordatorioTipo = (typeof RECORDATORIO_TIPOS)[number]

/** Tipos de evento del módulo de setters. Se suman a los de la bitácora. */
export const EVENT_TYPES_SETTERS = [
  'setter_creado',
  'setter_editado',
  'setter_pausado',
  'setter_reactivado',
  'setter_baja',
  'setter_eliminado',
  'equipo_vaciado',
  'password_restablecida',
  'password_cambiada',
  'sesiones_cerradas',
  'ingreso',
  'ingreso_fallido',
  'leads_asignados',
  'lead_abierto',
  'lead_contactado',
  'lead_segundo_enviado',
  'lead_respondio',
  'lead_clasificado',
  'lead_salteado',
  'lead_cuenta_inexistente',
  'lead_vencido',
  'lead_devuelto',
  'lead_reasignado',
  'lead_tomado_por_admin',
  'envio_setter_deshecho',
  'cuenta_setter_cambiada',
  'cuenta_setter_al_tope',
  'recordatorio_enviado',
  'mensaje_equipo_enviado',
  'mensaje_equipo_leido',
  'mensaje_equipo_respondido',
] as const

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

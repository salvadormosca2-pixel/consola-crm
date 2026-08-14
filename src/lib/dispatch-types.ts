import type { Channel, ContactStage } from '@/db/enums'

/**
 * Tipos y etiquetas de la cola del Despachador.
 *
 * Viven fuera de `src/server/dispatch.ts` porque la pantalla es un componente
 * cliente y necesita estos valores: importarlos desde el módulo de servidor
 * arrastraría `server-only` al bundle del navegador.
 */

export type Prioridad = 'vencido' | 'hoy' | 'nuevo'

/**
 * El orden de la cola no es negociable: primero los seguimientos vencidos,
 * después los de hoy, y recién al final los contactos nuevos. Con 300 mensajes
 * de techo por día, si los nuevos se comen el cupo los seguimientos se atrasan,
 * y ahí es donde se pierden las ventas.
 */
export const PRIORIDAD_META: Record<
  Prioridad,
  { label: string; tono: 'negativo' | 'activo' | 'neutral' }
> = {
  vencido: { label: 'Seguimiento vencido', tono: 'negativo' },
  hoy: { label: 'Seguimiento de hoy', tono: 'activo' },
  nuevo: { label: 'Primer mensaje', tono: 'neutral' },
}

export interface ItemDeCola {
  contactId: string
  businessName: string
  contactName: string | null
  niche: string | null
  city: string | null
  bought: string | null
  stage: ContactStage
  score: number
  sentCount: number
  receivedCount: number
  lastOutboundAt: Date | null
  prioridad: Prioridad
  paso: number
  channel: Channel
  /** Destino: teléfono E.164 o usuario de Instagram. */
  destino: string
  cuentaId: string
  cuentaCode: string
  cuentaLabel: string
  /** Cupo de esa cuenta hoy, para avisar antes de enviar. */
  cuentaUsado: number
  cuentaTecho: number
  cuentaCupo: number
  /** El mensaje ya armado. null si falta un dato. */
  mensaje: string | null
  /** Por qué no se pudo armar el mensaje. */
  motivoSaltado: string | null
  templateId: string | null
  templateVariant: number | null
  /** Link que abre el chat con el mensaje cargado. */
  link: string
  /**
   * true si esta cuenta puede mandar sola por la API de Chatwoot: un click y
   * sale, sin abrir WhatsApp. false = semi-automático por link.
   */
  envioAutomatico: boolean
}

export interface ColaDelDia {
  items: ItemDeCola[]
  totales: {
    vencidos: number
    hoy: number
    nuevos: number
    sinPlantilla: number
    saltados: number
  }
  /** Cuánto cupo queda entre todas las cuentas operativas del canal. */
  cupoDisponible: number
}

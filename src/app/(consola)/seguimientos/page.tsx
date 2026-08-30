import type { Metadata } from 'next'

import { requerirAdmin } from '@/server/session'
import { leerConfigSetters } from '@/server/setters/config'
import { listarMensajes } from '@/server/setters/mensajes'

import { Tiempos } from './tiempos'

export const metadata: Metadata = { title: 'Seguimientos · 101leads' }
export const dynamic = 'force-dynamic'

/**
 * Cuándo vuelve un lead a la cola, y con cuál de las situaciones.
 *
 * Acá está la escalera completa y nada más: un seguimiento sale por los días
 * que pasaron y por la situación en la que quedó el lead, no por orden de
 * lista, y eso solo se entiende viendo las situaciones juntas y comparables.
 *
 * El texto de cada una se escribe en Mensajes. De ahí solo se lee si está
 * escrito o no: una situación sin mensaje deja leads bloqueados, así que ese
 * dato tiene que estar acá aunque el texto viva en la otra pantalla.
 *
 * Y el control de si el equipo los hace está en Equipo: esta pantalla define
 * las reglas, esa mide si se cumplen.
 */
export default async function PaginaSeguimientos() {
  await requerirAdmin()

  const [cfg, mensajes] = await Promise.all([leerConfigSetters(), listarMensajes()])

  return (
    <Tiempos
      tiempos={{
        horasSegundoMensaje: cfg.horasSegundoMensaje,
        horasVencimiento: cfg.horasVencimiento,
        diasAtrasoParaAlerta: cfg.diasAtrasoParaAlerta,
        diasParaUltimoIntento: cfg.diasParaUltimoIntento,
        diasParaRetomarConversacion: cfg.diasParaRetomarConversacion,
        diasParaRetomarInteresado: cfg.diasParaRetomarInteresado,
        diasParaUltimoReenganche: cfg.diasParaUltimoReenganche,
      }}
      mensajes={{
        escritos: mensajes.filter((m) => m.rubro === null && m.activo).map((m) => m.paso),
      }}
    />
  )
}

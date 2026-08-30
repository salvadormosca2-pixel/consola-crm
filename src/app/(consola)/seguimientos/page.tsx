import type { Metadata } from 'next'

import { requerirAdmin } from '@/server/session'
import { leerConfigSetters } from '@/server/setters/config'
import { leerConfigDeMensajes, listarMensajes, rubrosConLeads } from '@/server/setters/mensajes'

import { Editor } from './editor'

export const metadata: Metadata = { title: 'Seguimientos · 101leads' }
export const dynamic = 'force-dynamic'

/**
 * Los seguimientos: cuándo vuelve un lead y con qué texto.
 *
 * Las dos mitades de la misma decisión, y por eso están en una sola pantalla.
 * Tenerlas separadas —los días en un panel de configuración y los textos en
 * otro— hacía imposible ver la escalera completa, que es lo único que importa
 * entender acá: un seguimiento sale por los días que pasaron y por la
 * situación en la que quedó el lead, no por orden de lista.
 *
 * El control de cómo viene el equipo con esos seguimientos está en Equipo:
 * esta pantalla define las reglas, esa mide si se cumplen.
 */
export default async function PaginaSeguimientos() {
  await requerirAdmin()

  const [config, mensajes, rubros, cfg] = await Promise.all([
    leerConfigDeMensajes(),
    listarMensajes(),
    rubrosConLeads(),
    leerConfigSetters(),
  ])

  return (
    <Editor
      config={config}
      mensajes={mensajes}
      rubros={rubros}
      tiempos={{
        horasSegundoMensaje: cfg.horasSegundoMensaje,
        horasVencimiento: cfg.horasVencimiento,
        diasAtrasoParaAlerta: cfg.diasAtrasoParaAlerta,
        diasParaUltimoIntento: cfg.diasParaUltimoIntento,
        diasParaRetomarConversacion: cfg.diasParaRetomarConversacion,
        diasParaRetomarInteresado: cfg.diasParaRetomarInteresado,
        diasParaUltimoReenganche: cfg.diasParaUltimoReenganche,
      }}
    />
  )
}

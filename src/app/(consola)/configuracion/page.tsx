import type { Metadata } from 'next'

import { requerirAdmin } from '@/server/session'
import { leerConfigSetters } from '@/server/setters/config'
import { leerConfigDeMensajes, listarMensajes, rubrosConLeads } from '@/server/setters/mensajes'

import { Editor } from './editor'

export const metadata: Metadata = { title: 'Mensajes · 101leads' }
export const dynamic = 'force-dynamic'

/**
 * Los mensajes que mandan los setters.
 *
 * Es la única configuración que quedó, y es la que más mueve el resultado: el
 * mensaje de entrada decide si contestan, y el de la oferta decide si compran.
 */
export default async function PaginaMensajes() {
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
      }}
    />
  )
}

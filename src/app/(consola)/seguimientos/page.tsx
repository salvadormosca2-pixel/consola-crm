import type { Metadata } from 'next'

import { requerirAdmin } from '@/server/session'
import { leerConfigSetters } from '@/server/setters/config'
import { leerConfigDeMensajes, listarMensajes, rubrosConLeads } from '@/server/setters/mensajes'

import { Tiempos } from './tiempos'

export const metadata: Metadata = { title: 'Seguimientos · 101leads' }
export const dynamic = 'force-dynamic'

/**
 * Los seguimientos: cuándo vuelve un lead a la cola, con cuál de las
 * situaciones, y qué le decimos.
 *
 * El día y el texto se editan juntos porque son una sola decisión: a los tres
 * días se escribe distinto que a los quince, y tener el número en otra pantalla
 * obligaba a escribir de memoria.
 *
 * Los mensajes que no son un seguimiento —la entrada, la oferta y los tres que
 * salen en el acto cuando el setter marca qué contestó— no dependen de ningún
 * día y se escriben en Mensajes.
 *
 * Y el control de si el equipo los hace está en Equipo: esta pantalla define
 * las reglas, esa mide si se cumplen.
 */
export default async function PaginaSeguimientos() {
  await requerirAdmin()

  const [cfg, config, mensajes, rubros] = await Promise.all([
    leerConfigSetters(),
    leerConfigDeMensajes(),
    listarMensajes(),
    rubrosConLeads(),
  ])

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
      mensajes={mensajes}
      config={config}
      rubros={rubros}
    />
  )
}

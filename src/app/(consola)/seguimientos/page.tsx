import type { Metadata } from 'next'

import { diasDeTodosLosPasos } from '@/lib/setters-config'
import { requerirAdmin } from '@/server/session'
import { leerConfigSetters } from '@/server/setters/config'
import { cupoDelDia } from '@/server/setters/cupo'
import { leerConfigDeMensajes, listarMensajes, rubrosConLeads } from '@/server/setters/mensajes'

import { PanelDePistas } from './pistas-panel'

export const metadata: Metadata = { title: 'Seguimientos · 101leads' }
export const dynamic = 'force-dynamic'

/**
 * Las pistas: por dónde sigue un lead y qué le decimos en cada escalón.
 *
 * El día y el texto de cada escalón se editan juntos porque son una sola
 * decisión: a los dos días se pregunta si lo vio y a los once se cierra la
 * puerta, y tener el número en otra pantalla obliga a escribir de memoria.
 *
 * Los textos del primer contacto —la entrada y la oferta— no dependen de ningún
 * día y se escriben en Mensajes, igual que los tres que salen en el acto cuando
 * el setter marca qué contestó.
 *
 * El control de si el equipo hace los seguimientos está en Equipo: esta
 * pantalla define las reglas, esa mide si se cumplen.
 */
export default async function PaginaSeguimientos() {
  await requerirAdmin()

  const [cfg, config, mensajes, rubros, cupo] = await Promise.all([
    leerConfigSetters(),
    leerConfigDeMensajes(),
    listarMensajes(),
    rubrosConLeads(),
    cupoDelDia(),
  ])

  return (
    <PanelDePistas
      datos={{
        // Ya resueltos con el default del modelo: una pista nueva funciona
        // apenas se agrega, sin pasar antes por acá a cargarle números.
        dias: diasDeTodosLosPasos(cfg),
        horasVencimiento: cfg.horasVencimiento,
        diasAtrasoParaAlerta: cfg.diasAtrasoParaAlerta,
      }}
      mensajes={mensajes}
      config={config}
      rubros={rubros}
      cupo={cupo}
    />
  )
}

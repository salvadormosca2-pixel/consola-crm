import type { Metadata } from 'next'

import { diasDeTodosLosPasos } from '@/lib/setters-config'
import { requerirAdmin } from '@/server/session'
import { leerConfigSetters } from '@/server/setters/config'

import { PanelDePistas } from './pistas-panel'

export const metadata: Metadata = { title: 'Seguimientos · 101leads' }
export const dynamic = 'force-dynamic'

/**
 * El recorrido de un lead y los días de cada escalón.
 *
 * El texto ya no se escribe acá: el de cada lead se escribe en Textos, uno por
 * uno. Lo que queda es el reloj, que sí es igual para todos.
 *
 * El control de si el equipo hace los seguimientos está en Equipo: esta
 * pantalla define las reglas, esa mide si se cumplen.
 */
export default async function PaginaSeguimientos() {
  await requerirAdmin()

  const cfg = await leerConfigSetters()

  return (
    <PanelDePistas
      datos={{
        // Ya resueltos con el default del modelo: una pista nueva funciona
        // apenas se agrega, sin pasar antes por acá a cargarle números.
        dias: diasDeTodosLosPasos(cfg),
        horasVencimiento: cfg.horasVencimiento,
        diasAtrasoParaAlerta: cfg.diasAtrasoParaAlerta,
      }}
    />
  )
}

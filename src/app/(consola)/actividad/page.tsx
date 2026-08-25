import type { Metadata } from 'next'

import { GRUPOS, type GrupoDeActividad } from '@/lib/actividad'
import { requerirAdmin } from '@/server/session'
import { listarActividad, resumenDeActividad } from '@/server/setters/actividad'

import { Registro } from './registro'

export const metadata: Metadata = { title: 'Actividad · Ecosystem' }
export const dynamic = 'force-dynamic'

function grupoValido(valor: string | undefined): GrupoDeActividad | undefined {
  return GRUPOS.includes(valor as GrupoDeActividad) ? (valor as GrupoDeActividad) : undefined
}

/**
 * Todo lo que pasó, con nombre y hora.
 *
 * Cada acción del sistema deja su rastro dentro de la misma transacción que la
 * ejecuta, así que no hay forma de que algo se haga y no quede registrado: si
 * el envío se guardó, su evento también, y si la transacción falló no queda
 * ninguno de los dos.
 *
 * Nada se borra. Deshacer un envío no saca la fila del envío, agrega la de que
 * se deshizo. Es lo que hace que esto sirva para resolver una discusión.
 */
export default async function PaginaActividad({
  searchParams,
}: {
  searchParams: Promise<{ grupo?: string; quien?: string; q?: string }>
}) {
  await requerirAdmin()
  const { grupo, quien, q } = await searchParams

  const filtros = {
    grupo: grupoValido(grupo),
    actorUserId: quien,
    busqueda: (q ?? '').slice(0, 80),
  }

  const [resumen, filas] = await Promise.all([
    resumenDeActividad(),
    listarActividad(filtros),
  ])

  return (
    <Registro
      resumen={resumen}
      filas={filas}
      filtros={{
        grupo: filtros.grupo ?? null,
        quien: quien ?? null,
        busqueda: filtros.busqueda,
      }}
    />
  )
}

import type { Metadata } from 'next'

import { PESTANAS, type Pestana } from '@/lib/setters-vistas'
import { requerirSetter } from '@/server/session'
import { listarMisLeads } from '@/server/setters/leads'

import { Lista } from './lista'

export const metadata: Metadata = { title: 'Mis leads · Setters' }
export const dynamic = 'force-dynamic'

function pestanaValida(valor: string | undefined): Pestana {
  return PESTANAS.includes(valor as Pestana) ? (valor as Pestana) : 'por_contactar'
}

export default async function PaginaMisLeads({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string; q?: string }>
}) {
  const sesion = await requerirSetter()
  const { ver, q } = await searchParams
  const pestana = pestanaValida(ver)
  const busqueda = (q ?? '').slice(0, 80)

  const datos = await listarMisLeads(sesion.setterId, pestana, busqueda)

  return <Lista datos={datos} pestana={pestana} busqueda={busqueda} />
}

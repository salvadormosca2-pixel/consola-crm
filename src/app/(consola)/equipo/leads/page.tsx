import Link from 'next/link'
import type { Metadata } from 'next'

import { VISTAS, type Vista } from '@/lib/setters-vistas'
import { requerirAdmin } from '@/server/session'
import { listarVista, listarSettersActivos } from '@/server/setters/panel'
import { revisarLeads } from '@/server/setters/revision'

import { Revision } from './revision'
import { VistaDeLeads } from './vista'

export const metadata: Metadata = { title: 'Leads del equipo · 101leads' }
export const dynamic = 'force-dynamic'

function vistaValida(valor: string | undefined): Vista {
  return VISTAS.includes(valor as Vista) ? (valor as Vista) : 'respondieron'
}

/**
 * Las vistas que necesito para saber qué está pasando con los leads del equipo.
 * Todas filtrables por setter y por fecha, y todas exportables.
 */
export default async function PaginaLeadsDelEquipo({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string; setter?: string; desde?: string; hasta?: string }>
}) {
  await requerirAdmin()
  const { ver, setter, desde, hasta } = await searchParams
  const vista = vistaValida(ver)

  const [filas, setters, revision] = await Promise.all([
    listarVista(vista, {
      setterId: setter || null,
      desde: desde || null,
      hasta: hasta || null,
    }),
    listarSettersActivos(),
    revisarLeads(),
  ])

  return (
    <div className="space-y-3">
      <div>
        <Link href="/equipo" className="text-[12px] text-texto-2 hover:text-texto">
          ← Equipo
        </Link>
        <h1 className="mt-1 text-[20px]">Leads del equipo</h1>
      </div>

      <Revision revision={revision} />

      <VistaDeLeads
        vista={vista}
        filas={filas}
        setters={setters}
        filtros={{ setterId: setter ?? '', desde: desde ?? '', hasta: hasta ?? '' }}
      />
    </div>
  )
}

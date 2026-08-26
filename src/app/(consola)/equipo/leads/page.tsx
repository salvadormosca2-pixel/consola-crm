import Link from 'next/link'
import type { Metadata } from 'next'

import { VISTAS, type Vista } from '@/lib/setters-vistas'
import { requerirAdmin } from '@/server/session'
import { listarVista, listarSettersActivos } from '@/server/setters/panel'

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

  const [filas, setters] = await Promise.all([
    listarVista(vista, {
      setterId: setter || null,
      desde: desde || null,
      hasta: hasta || null,
    }),
    listarSettersActivos(),
  ])

  return (
    <div className="space-y-3">
      <div>
        <Link href="/equipo" className="text-[12px] text-texto-2 hover:text-texto">
          ← Equipo
        </Link>
        <h1 className="mt-1 text-[20px]">Leads del equipo</h1>
      </div>

      <VistaDeLeads
        vista={vista}
        filas={filas}
        setters={setters}
        filtros={{ setterId: setter ?? '', desde: desde ?? '', hasta: hasta ?? '' }}
      />
    </div>
  )
}

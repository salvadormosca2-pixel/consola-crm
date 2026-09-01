import { Instagram as IconoInstagram } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { EmptyState } from '@/components/ui/empty-state'
import { Panel } from '@/components/ui/panel'
import { SETTERS_CONFIG_DEFAULT } from '@/lib/setters-config'
import { requerirAdmin } from '@/server/session'
import { listarCuentasDelEquipo } from '@/server/setters/panel'

import { Cuentas } from './cuentas'

export const metadata: Metadata = { title: 'Cuentas de Instagram · 101leads' }
export const dynamic = 'force-dynamic'

/**
 * Una pantalla que edita una sola cosa: con qué cuenta de Instagram trabaja
 * cada uno. Es lo que queda pendiente después de un alta en lote, y lo que
 * decide quién recibe leads y quién no.
 */
export default async function PaginaCuentasDeInstagram() {
  await requerirAdmin()
  const equipo = await listarCuentasDelEquipo()

  return (
    <div className="mx-auto max-w-[620px] space-y-3">
      <div>
        <Link href="/equipo" className="text-[12px] text-texto-2 hover:text-texto">
          ← Equipo
        </Link>
        <h1 className="mt-1 text-[20px]">Cuentas de Instagram</h1>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-texto-2">
          Con qué cuenta escribe cada uno, y cuántos mensajes por día le entran. Su tanda de leads
          del día pasa a ser la suma de esos cupos: si le cargás una segunda cuenta, recibe el
          doble. El nombre y el acceso no se tocan desde acá.
        </p>
      </div>

      {equipo.length === 0 ? (
        <Panel>
          <EmptyState
            icono={IconoInstagram}
            titulo="Todavía no hay setters"
            detalle="Dalos de alta primero desde Equipo → Nuevo setter y después volvé acá a cargarles la cuenta."
          />
        </Panel>
      ) : (
        <Cuentas equipo={equipo} cupoPorDefecto={SETTERS_CONFIG_DEFAULT.cupoPorCuentaDefault} />
      )}
    </div>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'

import { SETTERS_CONFIG_DEFAULT } from '@/lib/setters-config'
import { requerirAdminMadre } from '@/server/session'

import { Lote } from '../lote'

export const metadata: Metadata = { title: 'Alta en lote · 101leads' }

export default async function PaginaAltaEnLote() {
  await requerirAdminMadre()

  return (
    <div className="mx-auto max-w-[560px] space-y-3">
      <div>
        <Link href="/equipo/nuevo" className="text-[12px] text-texto-2 hover:text-texto">
          ← Nuevo setter
        </Link>
        <h1 className="mt-1 text-[20px]">Alta en lote</h1>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-texto-2">
          Para cuando entra un equipo entero: pegás los mails, revisás los nombres y salen todas
          las tarjetas de acceso juntas. Cada contraseña se ve una sola vez.
        </p>
      </div>

      <Lote tandaPorDefecto={SETTERS_CONFIG_DEFAULT.cupoPorCuentaDefault} />
    </div>
  )
}

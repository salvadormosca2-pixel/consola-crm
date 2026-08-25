import type { Metadata } from 'next'
import Link from 'next/link'

import { SETTERS_CONFIG_DEFAULT } from '@/lib/setters-config'
import { requerirAdminMadre } from '@/server/session'

import { Alta } from './alta'

export const metadata: Metadata = { title: 'Nuevo setter · Ecosystem' }

export default async function PaginaNuevoSetter() {
  await requerirAdminMadre()

  return (
    <div className="mx-auto max-w-[560px] space-y-3">
      <div>
        <Link href="/equipo" className="text-[12px] text-texto-2 hover:text-texto">
          ← Equipo
        </Link>
        <h1 className="mt-1 text-[20px]">Nuevo setter</h1>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-texto-2">
          Al guardar se genera una contraseña temporal y una tarjeta lista para mandarle por
          WhatsApp. La contraseña se ve una sola vez.
        </p>
      </div>

      <Alta cupoPorDefecto={SETTERS_CONFIG_DEFAULT.cupoPorCuentaDefault} />
    </div>
  )
}

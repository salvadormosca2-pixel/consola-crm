import type { Metadata } from 'next'

import { cuentasDePrueba } from '@/server/actions/auth'
import type { MotivoDeCorte } from '@/server/session'

import { AccesoRapido } from './acceso-rapido'
import { FormularioIngreso } from './form'

export const metadata: Metadata = { title: 'Ingresar · 101leads' }

/** Por qué lo sacamos de la app. Si no lo decimos, cree que se rompió algo. */
const MOTIVOS: Record<MotivoDeCorte, string> = {
  sesion_vieja: 'Se cerró tu sesión en todos los dispositivos. Entrá de nuevo.',
  cuenta_pausada: 'Tu cuenta está pausada. Hablá con el administrador.',
  cuenta_baja: 'Tu cuenta está dada de baja.',
  cuenta_borrada: 'Tu cuenta ya no está disponible.',
}

export default async function PaginaIngreso({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string }>
}) {
  const { motivo } = await searchParams
  const aviso = motivo && motivo in MOTIVOS ? MOTIVOS[motivo as MotivoDeCorte] : null
  const prueba = await cuentasDePrueba()

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-[340px]">
        <div className="mb-5">
          <div className="font-[family-name:var(--font-titulo)] text-[22px] font-bold tracking-[-0.045em]">
            101leads<span className="text-acento">.</span>
          </div>
          <p className="mt-1 text-[12px] text-texto-2">Seguimiento de clientes.</p>
        </div>

        {prueba.length > 0 ? <AccesoRapido cuentas={prueba} /> : null}

        <FormularioIngreso aviso={aviso} conAccesoRapido={prueba.length > 0} />
      </div>
    </main>
  )
}

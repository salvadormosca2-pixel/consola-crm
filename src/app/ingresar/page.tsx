import type { Metadata } from 'next'

import { FormularioIngreso } from './form'

export const metadata: Metadata = { title: 'Ingresar · Consola' }

export default function PaginaIngreso() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-[300px]">
        <div className="mb-5">
          <div className="font-[family-name:var(--font-titulo)] text-[22px] font-bold tracking-[-0.045em]">
            consola<span className="text-ambar">.</span>
          </div>
          <p className="mt-1 text-[12px] text-texto-2">Seguimiento de clientes.</p>
        </div>
        <FormularioIngreso />
      </div>
    </main>
  )
}

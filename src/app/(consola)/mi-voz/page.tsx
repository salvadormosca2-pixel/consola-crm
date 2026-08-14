import type { Metadata } from 'next'

import { leerVoz } from '@/server/contacts'

import { EditorDeVoz } from './editor'

export const metadata: Metadata = { title: 'Mi voz · Consola' }
export const dynamic = 'force-dynamic'

export default async function PaginaMiVoz() {
  const voz = await leerVoz()

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[20px]">Mi voz</h1>
        <p className="mt-0.5 max-w-2xl text-[12.5px] leading-relaxed text-texto-2">
          Los arranques que usás de verdad, guardados para tenerlos de referencia al escribir una
          plantilla. Son clientes que ya te compraron: un mensaje que suena a plantilla se nota.
        </p>
      </div>

      <EditorDeVoz inicial={voz} />
    </div>
  )
}

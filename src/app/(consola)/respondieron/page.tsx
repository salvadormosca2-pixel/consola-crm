import Link from 'next/link'
import type { Metadata } from 'next'

import { AvisoDemo } from '@/components/aviso-demo'
import { Panel } from '@/components/ui/panel'
import { listarRespondieron } from '@/server/contacts'

import { Bandeja } from './bandeja'

export const metadata: Metadata = { title: 'Respondieron · Consola' }
export const dynamic = 'force-dynamic'

export default async function PaginaRespondieron({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string }>
}) {
  const { ver } = await searchParams
  const soloSinClasificar = ver !== 'todos'

  const filas = await listarRespondieron(soloSinClasificar)

  return (
    <div className="space-y-3">
      <AvisoDemo />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[20px]">Respondieron</h1>
          <p className="mt-0.5 text-[12.5px] text-texto-2">
            Los que contestaron y todavía no clasificaste, ordenados por el que hace más que espera.
          </p>
        </div>
        <span className="dato text-[13px] text-texto">
          {filas.length}
          <span className="text-texto-2"> {soloSinClasificar ? 'sin clasificar' : 'con respuesta'}</span>
        </span>
      </div>

      <nav className="flex gap-0.5 border-b border-borde" aria-label="Qué mostrar">
        <Solapa href="/respondieron" activa={soloSinClasificar} texto="Sin clasificar" />
        <Solapa href="/respondieron?ver=todos" activa={!soloSinClasificar} texto="Todos los que respondieron" />
      </nav>

      {filas.length > 0 ? (
        <Bandeja filas={filas} />
      ) : (
        <Panel className="px-6 py-12 text-center">
          <h2 className="text-[15px]">
            {soloSinClasificar ? 'No hay nada sin clasificar' : 'Todavía no contestó nadie'}
          </h2>
          <p className="mt-1.5 text-[12.5px] text-texto-2">
            {soloSinClasificar ? (
              <>
                Cuando alguien conteste, aparece acá.{' '}
                <Link href="/respondieron?ver=todos" className="text-ambar underline underline-offset-2">
                  Ver todos los que respondieron
                </Link>
              </>
            ) : (
              'Las respuestas entran solas por el webhook de Chatwoot, o las marcás a mano desde la lista de contactos.'
            )}
          </p>
        </Panel>
      )}
    </div>
  )
}

function Solapa({ href, activa, texto }: { href: string; activa: boolean; texto: string }) {
  return (
    <Link
      href={href as never}
      aria-current={activa ? 'page' : undefined}
      className={
        'border-b-2 px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-150 ' +
        (activa ? 'border-ambar text-texto' : 'border-transparent text-texto-2 hover:text-texto')
      }
    >
      {texto}
    </Link>
  )
}

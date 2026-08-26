import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { Panel } from '@/components/ui/panel'
import { esRespuesta, type Respuesta } from '@/lib/respuestas-vistas'
import { requerirAdmin } from '@/server/session'
import {
  conteosDeRespuestas,
  generalDeRespuestas,
  respuestasDetalladas,
} from '@/server/setters/respuestas'

import { Bandeja } from '../bandeja'
import { Clasificaciones } from '../clasificaciones'

export const metadata: Metadata = { title: 'Respuestas del setter · 101leads' }
export const dynamic = 'force-dynamic'

/**
 * Las respuestas de una persona, con todo el detalle.
 *
 * Los mismos cinco números de la pantalla general pero solo suyos, y al tocar
 * cualquiera se abre la lista completa: a qué contestó cada uno, qué dijo
 * exactamente y los botones para clasificarlo. Se entra y se sale.
 */
export default async function PaginaRespuestasDelSetter({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ ver?: string }>
}) {
  await requerirAdmin()
  const { id } = await params
  const { ver } = await searchParams
  const abierta: Respuesta | null = esRespuesta(ver) ? ver : null

  // La ficha sale de la misma consulta que la general: así el número de acá y
  // el de la lista de nombres no pueden discrepar.
  const general = await generalDeRespuestas()
  const suyo = general.setters.find((s) => s.setterId === id)
  if (!suyo) notFound()

  const [conteos, filas] = await Promise.all([
    conteosDeRespuestas(id),
    abierta ? respuestasDetalladas(abierta, id) : Promise.resolve([]),
  ])

  const respuestas = suyo.conteos.sin_oferta + suyo.conteos.oferta
  const tasa = suyo.contactados > 0 ? Math.round((respuestas / suyo.contactados) * 100) : 0

  return (
    <div className="space-y-4">
      <div>
        <Link href="/respondieron" className="text-[12px] text-texto-2 hover:text-texto">
          ← Respondieron
        </Link>
        <h1 className="mt-1 text-[20px]">{suyo.nombre}</h1>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Dato valor={suyo.contactados} rotulo="contactados en total" />
          <Dato valor={respuestas} rotulo="le contestaron" />
          <Dato valor={tasa} sufijo="%" rotulo="de respuesta" />
          <Link
            href={`/equipo/${suyo.setterId}` as never}
            className="ml-auto text-[12.5px] text-acento hover:underline"
          >
            Ver su ficha completa →
          </Link>
        </div>
      </Panel>

      <Clasificaciones
        conteos={conteos}
        abierta={abierta}
        base={`/respondieron/${suyo.setterId}`}
        enSetter
      />

      {abierta ? (
        <Bandeja
          vista={abierta}
          filas={filas}
          base={`/respondieron/${suyo.setterId}`}
          conNombreDelSetter={false}
        />
      ) : null}
    </div>
  )
}

function Dato({ valor, sufijo, rotulo }: { valor: number; sufijo?: string; rotulo: string }) {
  return (
    <span className="text-[12px] text-texto-2">
      <span className="dato text-[20px] font-semibold text-texto">{valor}</span>
      {sufijo ? <span className="dato text-[14px] text-texto">{sufijo}</span> : null} {rotulo}
    </span>
  )
}

import type { Metadata } from 'next'

import { Panel } from '@/components/ui/panel'
import { esRespuesta, type Respuesta } from '@/lib/respuestas-vistas'
import { requerirAdmin } from '@/server/session'
import { generalDeRespuestas, respuestasDetalladas } from '@/server/setters/respuestas'

import { Bandeja } from './bandeja'
import { Clasificaciones } from './clasificaciones'
import { ListaDeSetters } from './lista-de-setters'

export const metadata: Metadata = { title: 'Respondieron · 101leads' }
export const dynamic = 'force-dynamic'

/**
 * Los que contestaron, separados por setter.
 *
 * Arriba los números del equipo y abajo los nombres. El detalle de cada
 * persona está en su propia pantalla: amontonar doscientas respuestas de tres
 * setters en una lista obliga a leerlas todas para encontrar las de uno.
 */
export default async function PaginaRespondieron({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string }>
}) {
  await requerirAdmin()
  const { ver } = await searchParams
  const abierta: Respuesta | null = esRespuesta(ver) ? ver : null

  const general = await generalDeRespuestas()
  const filas = abierta ? await respuestasDetalladas(abierta) : []

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px]">Respondieron</h1>
        <p className="mt-0.5 max-w-[720px] text-[12.5px] leading-relaxed text-texto-2">
          Todo lo que contestó el equipo, etiquetado: quién lo contactó, a qué mensaje contestó y
          qué dijo. Tocá un número para verlos, o un nombre para entrar a lo de esa persona.
        </p>
      </div>

      <Clasificaciones conteos={general.conteos} abierta={abierta} base="/respondieron" />

      {abierta ? <Bandeja vista={abierta} filas={filas} base="/respondieron" /> : null}

      {general.setters.length === 0 ? (
        <Panel className="px-6 py-12 text-center">
          <h2 className="text-[15px]">Todavía no contestó nadie</h2>
          <p className="mt-1.5 text-[12.5px] text-texto-2">
            Los setters marcan las respuestas desde el celular. Cuando alguien conteste, aparece
            acá con el nombre de quien lo trajo.
          </p>
        </Panel>
      ) : (
        <ListaDeSetters setters={general.setters} sinSetter={general.sinSetter} />
      )}
    </div>
  )
}

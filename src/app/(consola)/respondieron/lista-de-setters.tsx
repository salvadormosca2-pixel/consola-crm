import { ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { Panel, PanelHeader } from '@/components/ui/panel'
import { haceCuanto } from '@/lib/tz'
import { cn } from '@/lib/utils'
import type { SetterConRespuestas } from '@/server/setters/respuestas'

/**
 * Los nombres, con lo justo para saber a quién entrar.
 *
 * La tasa de respuesta va acá porque es lo único que compara a dos setters de
 * verdad: los leads se reparten al azar, así que un 4% contra un 15% no es
 * suerte. Los detalles de cada uno están adentro, no en esta lista.
 */
export function ListaDeSetters({
  setters,
  sinSetter,
}: {
  setters: SetterConRespuestas[]
  sinSetter: number
}) {
  return (
    <Panel>
      <PanelHeader
        titulo="El equipo"
        descripcion="Tocá un nombre para ver sus respuestas con todo el detalle."
      />

      <div className="divide-y divide-borde">
        {setters.map((s) => {
          // Todos los que abrieron la boca alguna vez: los que esperan la
          // oferta, los que ya la recibieron y los que la contestaron. Es el
          // numerador de la tasa, así que tiene que estar entero.
          const respuestas =
            s.conteos.sin_oferta + s.conteos.oferta_enviada + s.conteos.oferta
          const tasa = s.contactados > 0 ? Math.round((respuestas / s.contactados) * 100) : 0
          return (
            <Link
              key={s.setterId}
              href={`/respondieron/${s.setterId}` as never}
              className="group flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-elevada/40"
            >
              <div className="min-w-[150px] flex-1">
                <span className="inline-flex items-center gap-1 text-[15px] font-medium text-texto group-hover:text-acento">
                  {s.nombre}
                  <ChevronRight className="h-3.5 w-3.5 opacity-50" aria-hidden />
                </span>
                <p className="mt-0.5 text-[11.5px] text-texto-2">
                  {s.ultimaRespuesta
                    ? `última respuesta ${haceCuanto(s.ultimaRespuesta)}`
                    : 'todavía no le contestó nadie'}
                  {' · '}
                  <span className="dato">{tasa}%</span> de los que contactó
                </p>
              </div>

              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <Dato valor={s.contactados} rotulo="contactó a" />
                <Dato valor={respuestas} rotulo="le contestaron" />
                <Dato
                  valor={s.conteos.sin_oferta}
                  rotulo="sin la oferta"
                  tono={s.conteos.sin_oferta > 0 ? 'ambar' : undefined}
                />
                <Dato valor={s.conteos.interesados} rotulo="interesados" tono="verde" />
                <Dato
                  valor={s.conteos.sin_clasificar}
                  rotulo="sin clasificar"
                  tono={s.conteos.sin_clasificar > 0 ? 'rojo' : undefined}
                />
              </div>
            </Link>
          )
        })}
      </div>

      {/* Contactos que no vinieron del equipo. Se cuentan aparte para que los
          números por setter cierren con el total de arriba. */}
      {sinSetter > 0 ? (
        <p className="border-t border-borde px-4 py-2 text-[11.5px] text-texto-2">
          Además hay <span className="dato text-texto">{sinSetter}</span> respuestas que no vinieron
          del equipo de Instagram: contactos viejos o cargados a mano.
        </p>
      ) : null}
    </Panel>
  )
}

function Dato({
  valor,
  rotulo,
  tono,
}: {
  valor: number
  rotulo: string
  tono?: 'ambar' | 'verde' | 'rojo'
}) {
  const color =
    tono === 'rojo'
      ? 'text-rojo'
      : tono === 'ambar'
        ? 'text-ambar'
        : tono === 'verde'
          ? 'text-verde'
          : 'text-texto'
  return (
    <span className="text-[11.5px] text-texto-2">
      <span className={cn('dato text-[17px] font-semibold', color)}>{valor}</span> {rotulo}
    </span>
  )
}

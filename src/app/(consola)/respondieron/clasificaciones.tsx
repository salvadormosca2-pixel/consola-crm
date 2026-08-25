'use client'

import { useRouter } from 'next/navigation'
import * as React from 'react'

import {
  RESPUESTAS,
  RESPUESTA_VISTA_META,
  type Respuesta,
} from '@/lib/respuestas-vistas'
import { cn } from '@/lib/utils'
import type { ConteosDeRespuestas } from '@/server/setters/respuestas'

/**
 * Los cinco números de la bandeja, en dos grupos.
 *
 * "Para atender" es lo que tengo que sacar hoy; "Respondieron la oferta" es el
 * resultado del equipo. Tocar uno abre su lista abajo.
 */
export function Clasificaciones({
  conteos,
  abierta,
  base,
  enSetter = false,
}: {
  conteos: ConteosDeRespuestas
  abierta: Respuesta | null
  base: string
  enSetter?: boolean
}) {
  const router = useRouter()

  function alternar(v: Respuesta): void {
    router.push((v === abierta ? base : `${base}?ver=${v}`) as never, { scroll: false })
  }

  return (
    <div className="space-y-3">
      <Grupo
        titulo="Para atender"
        vistas={RESPUESTAS.filter((v) => RESPUESTA_VISTA_META[v].grupo === 'atender')}
        conteos={conteos}
        abierta={abierta}
        onTocar={alternar}
        enSetter={enSetter}
      />
      <Grupo
        titulo="Respondieron la oferta"
        vistas={RESPUESTAS.filter((v) => RESPUESTA_VISTA_META[v].grupo === 'oferta')}
        conteos={conteos}
        abierta={abierta}
        onTocar={alternar}
        enSetter={enSetter}
      />
    </div>
  )
}

function Grupo({
  titulo,
  vistas,
  conteos,
  abierta,
  onTocar,
  enSetter,
}: {
  titulo: string
  vistas: readonly Respuesta[]
  conteos: ConteosDeRespuestas
  abierta: Respuesta | null
  onTocar: (v: Respuesta) => void
  enSetter: boolean
}) {
  return (
    <div>
      <h2 className="mb-1.5 px-0.5 text-[12px] font-medium uppercase tracking-[0.04em] text-texto-2">
        {titulo}
      </h2>
      <div className={cn('grid gap-2', vistas.length > 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {vistas.map((v) => {
          const meta = RESPUESTA_VISTA_META[v]
          const n = conteos[v]
          const activa = abierta === v
          const color =
            n === 0
              ? 'text-texto-2'
              : meta.tono === 'malo'
                ? 'text-rojo'
                : meta.tono === 'bueno'
                  ? 'text-verde'
                  : 'text-texto'
          return (
            <button
              key={v}
              onClick={() => onTocar(v)}
              aria-expanded={activa}
              title={meta.detalle}
              className={cn(
                'rounded-[10px] border bg-superficie px-3 py-2.5 text-left transition-colors duration-150',
                activa
                  ? 'border-acento ring-2 ring-acento/15'
                  : 'border-borde hover:border-borde-fuerte',
              )}
            >
              <div className={cn('dato text-[24px] font-semibold leading-none', color)}>{n}</div>
              <div className="mt-1 text-[12px] leading-snug text-texto-2">
                {enSetter ? meta.enSetter : meta.label}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

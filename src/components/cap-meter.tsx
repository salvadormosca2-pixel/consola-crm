'use client'

import * as React from 'react'

import { esOperativa, type AccountStatus } from '@/db/enums'
import { cn } from '@/lib/utils'

export interface LecturaCuenta {
  id: string
  code: string
  label: string
  channel: 'whatsapp' | 'instagram'
  status: AccountStatus
  /** Cupo efectivo del día: el de warmup si está calentando, si no el normal. */
  cap: number
  /** Mensajes ya enviados hoy por esta cuenta. */
  enviados: number
}

const SEGMENTOS = 10

/**
 * Medidor de cupo. Cada cuenta es una barra vertical segmentada tipo consola
 * de sonido: se llena en ámbar a medida que consume su cupo, pasa a rojo al
 * tope y se atenúa si está pausada o bloqueada.
 *
 * Es la única pieza decorativa permitida, y es informativa: de un vistazo se ve
 * el estado de toda la operación.
 */
export function CapMeter({
  cuentas,
  className,
  compacto = false,
}: {
  cuentas: LecturaCuenta[]
  className?: string
  compacto?: boolean
}) {
  if (cuentas.length === 0) {
    return (
      <div className={cn('flex items-center gap-2 text-[11px] text-texto-2', className)}>
        <BarrasApagadas />
        <span>Sin cuentas cargadas</span>
      </div>
    )
  }

  const totalCap = cuentas.reduce((a, c) => a + (esOperativa(c.status) ? c.cap : 0), 0)
  const totalEnviados = cuentas.reduce((a, c) => a + c.enviados, 0)

  // Agrupadas por canal: sin esto, WA-01 e IG-01 quedan rotulados igual y no se
  // distingue de qué canal es cada barra.
  const grupos = (['whatsapp', 'instagram'] as const)
    .map((canal) => ({ canal, cuentas: cuentas.filter((c) => c.channel === canal) }))
    .filter((g) => g.cuentas.length > 0)

  return (
    <div className={cn('flex items-end gap-3', className)}>
      <div className="flex items-end gap-3" role="img" aria-label={etiquetaAccesible(cuentas)}>
        {grupos.map((g) => (
          <div key={g.canal} className="flex flex-col items-start gap-1">
            <div className="flex items-end gap-[3px]">
              {g.cuentas.map((c) => (
                <Barra key={c.id} cuenta={c} />
              ))}
            </div>
            <span className="rotulo text-[8.5px] leading-none">
              {g.canal === 'whatsapp' ? 'WhatsApp' : 'Instagram'}
            </span>
          </div>
        ))}
      </div>
      {!compacto ? (
        <div className="mb-px leading-tight">
          <div className="rotulo">Cupo del día</div>
          <div className="dato text-[13px] text-texto">
            {totalEnviados}
            <span className="text-texto-2">/{totalCap}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Barra({ cuenta }: { cuenta: LecturaCuenta }) {
  const { cap, enviados, status } = cuenta
  const operativa = esOperativa(status)
  const ratio = cap > 0 ? Math.min(enviados / cap, 1) : 0
  const llenos = cap > 0 ? Math.min(Math.ceil(ratio * SEGMENTOS), SEGMENTOS) : 0
  const alTope = cap > 0 && enviados >= cap
  const bloqueada = status === 'bloqueada'

  const restantes = Math.max(cap - enviados, 0)
  const titulo =
    `${cuenta.code} · ${cuenta.label}\n` +
    `${ETIQUETA_ESTADO[status]} · ${enviados}/${cap} enviados` +
    (operativa && !alTope ? ` · quedan ${restantes}` : alTope ? ' · cupo agotado' : '')

  return (
    <div
      className="group flex cursor-default flex-col items-center gap-1"
      title={titulo}
      data-cuenta={cuenta.code}
    >
      <div className="flex flex-col-reverse gap-[2px]">
        {Array.from({ length: SEGMENTOS }, (_, i) => {
          const activo = i < llenos
          return (
            <span
              key={i}
              className={cn(
                'block h-[3px] w-[7px] rounded-[1px] transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
                !activo && 'bg-borde/55',
                activo && !operativa && 'bg-texto-2/35',
                activo && operativa && !alTope && 'bg-ambar',
                activo && operativa && alTope && 'bg-rojo',
                bloqueada && 'bg-rojo/30',
              )}
            />
          )
        })}
      </div>
      <span
        className={cn(
          'dato text-[8.5px] leading-none transition-colors duration-150',
          operativa ? 'text-texto-2 group-hover:text-texto' : 'text-texto-2/45',
        )}
      >
        {etiquetaCorta(cuenta.code)}
      </span>
    </div>
  )
}

function BarrasApagadas() {
  return (
    <div className="flex items-end gap-[3px]" aria-hidden>
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="flex flex-col gap-[2px]">
          {Array.from({ length: SEGMENTOS }, (_, j) => (
            <span key={j} className="block h-[3px] w-[7px] rounded-[1px] bg-borde/30" />
          ))}
        </div>
      ))}
    </div>
  )
}

const ETIQUETA_ESTADO: Record<AccountStatus, string> = {
  esperando_preparacion: 'Esperando preparación',
  calentando: 'Calentando',
  activa: 'Activa',
  pausada: 'Pausada',
  bloqueada: 'Bloqueada',
}

/**
 * Rótulo de 2 caracteres bajo cada barra. Se le saca el prefijo de canal
 * (que ya lo dice el grupo) y se queda con el final del código, que es lo que
 * distingue una cuenta de otra.
 */
export function etiquetaCorta(code: string): string {
  const sinPrefijo = code.replace(/^(WA|IG)[-_.]?/i, '')
  const limpio = sinPrefijo.length > 0 ? sinPrefijo : code
  return limpio.slice(-2)
}

function etiquetaAccesible(cuentas: LecturaCuenta[]): string {
  return `Cupo por cuenta: ${cuentas
    .map((c) => `${c.code} ${c.enviados} de ${c.cap}`)
    .join('; ')}`
}

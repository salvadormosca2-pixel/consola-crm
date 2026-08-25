'use client'

import { BellRing, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { haceCuanto } from '@/lib/tz'
import { cn } from '@/lib/utils'
import { recordar, recordarATodos } from '@/server/actions/avisos'
import type { SetterEnLista } from '@/server/setters/seguimientos'

/**
 * Los nombres, y nada más que lo justo para saber a quién hay que entrar.
 *
 * Cuatro números por persona —contactó, le faltan, hizo seguimiento, le falta
 * seguir— y el nombre lleva a su ficha. El detalle no se abre acá: si cada
 * línea se pudiera desplegar, esto volvería a ser la pantalla larga que no se
 * entendía.
 */
export function ListaDeSetters({
  setters,
  diasParaAlerta,
  atrasadosEnTotal,
}: {
  setters: SetterEnLista[]
  diasParaAlerta: number
  atrasadosEnTotal: number
}) {
  const router = useRouter()
  const [pendiente, iniciar] = React.useTransition()

  const conAtraso = setters.filter((s) => s.conteos.atrasados > 0).length

  function avisar(setterId: string, nombre: string): void {
    iniciar(async () => {
      const r = await recordar(setterId, 'seguimientos')
      if (r.ok) {
        toast.success(`Le llegó el aviso a ${nombre}`)
        router.refresh()
      } else {
        toast.error(r.error ?? 'No se pudo avisar.')
      }
    })
  }

  function avisarATodos(): void {
    iniciar(async () => {
      const r = await recordarATodos('seguimientos')
      if (r.ok) {
        toast.success(r.avisados === 1 ? 'Le avisé a 1 setter' : `Les avisé a ${r.avisados} setters`)
        router.refresh()
      } else {
        toast.error(r.error ?? 'No se pudo avisar.')
      }
    })
  }

  return (
    <Panel>
      <PanelHeader
        titulo="El equipo"
        descripcion={
          conAtraso === 0
            ? 'Nadie está atrasado.'
            : `${conAtraso} ${conAtraso === 1 ? 'setter arrastra' : 'setters arrastran'} ${atrasadosEnTotal} seguimientos de días anteriores.`
        }
        acciones={
          <Button variant="primaria" disabled={pendiente || conAtraso === 0} onClick={avisarATodos}>
            <BellRing aria-hidden />
            Reclamar a todos
          </Button>
        }
      />

      <div className="divide-y divide-borde">
        {setters.map((s) => {
          const alerta = s.diasAtraso >= diasParaAlerta
          return (
            <div key={s.setterId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <Link
                href={`/equipo/seguimientos/${s.setterId}` as never}
                className="group min-w-[150px] flex-1"
              >
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-[15px] font-medium group-hover:text-acento',
                    alerta ? 'text-rojo' : 'text-texto',
                  )}
                >
                  {s.nombre}
                  <ChevronRight className="h-3.5 w-3.5 opacity-50" aria-hidden />
                </span>
                <p className="mt-0.5 text-[11.5px] text-texto-2">
                  {s.ultimaActividad ? `activo ${haceCuanto(s.ultimaActividad)}` : 'nunca mandó nada'}
                  {alerta ? ` · ${s.diasAtraso} días de atraso` : ''}
                </p>
              </Link>

              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <Dato valor={s.conteos.contactados} rotulo="contactó a" />
                <Dato
                  valor={s.conteos.por_contactar}
                  rotulo="le faltan"
                  tono={s.conteos.por_contactar > 0 ? 'ambar' : undefined}
                />
                <Dato valor={s.conteos.seguimiento_hecho} rotulo="siguió a" tono="verde" />
                <Dato
                  valor={s.conteos.falta_seguimiento}
                  rotulo="le falta seguir a"
                  tono={s.conteos.atrasados > 0 ? 'rojo' : s.conteos.falta_seguimiento > 0 ? 'ambar' : undefined}
                />
              </div>

              <Button
                variant={alerta ? 'destructiva' : 'secundaria'}
                size="sm"
                disabled={pendiente || s.conteos.falta_seguimiento === 0}
                onClick={() => avisar(s.setterId, s.nombre)}
                title={
                  s.ultimoRecordatorio
                    ? `Último aviso ${haceCuanto(s.ultimoRecordatorio)}`
                    : 'Todavía no le mandé ninguno'
                }
              >
                <BellRing aria-hidden />
                Reclamar
              </Button>
            </div>
          )
        })}
      </div>
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

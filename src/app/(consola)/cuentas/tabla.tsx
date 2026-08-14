'use client'

import { Instagram, MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/panel'
import { Panel } from '@/components/ui/panel'
import { ACCOUNT_STATUS_META, type AccountStatus } from '@/db/enums'
import type { FilaCuenta } from '@/server/accounts'
import { borrarCuenta, cambiarEstadoCuenta } from '@/server/actions/accounts'
import { cn } from '@/lib/utils'

import { DialogoCuenta } from './dialogo'

export function BotonNuevaCuenta() {
  const [abierto, setAbierto] = React.useState(false)
  return (
    <>
      <Button variant="primaria" size="md" onClick={() => setAbierto(true)}>
        <Plus aria-hidden />
        Agregar cuenta
      </Button>
      <DialogoCuenta abierto={abierto} onCerrar={() => setAbierto(false)} cuenta={null} />
    </>
  )
}

export function TablaCuentas({ cuentas }: { cuentas: FilaCuenta[] }) {
  const [editando, setEditando] = React.useState<FilaCuenta | null>(null)
  const [pendiente, iniciarTransicion] = React.useTransition()

  function cambiarEstado(cuenta: FilaCuenta, status: AccountStatus) {
    iniciarTransicion(async () => {
      const r = await cambiarEstadoCuenta(cuenta.id, status)
      if (r.ok) toast.success(`${cuenta.code}: ${ACCOUNT_STATUS_META[status].label.toLowerCase()}`)
      else toast.error(r.error ?? 'No se pudo cambiar el estado.')
    })
  }

  function borrar(cuenta: FilaCuenta) {
    if (!window.confirm(`¿Borrar la cuenta ${cuenta.code}? No se puede deshacer.`)) return
    iniciarTransicion(async () => {
      const r = await borrarCuenta(cuenta.id)
      if (r.ok) toast.success(`Cuenta ${cuenta.code} borrada`)
      else toast.error(r.error ?? 'No se pudo borrar.')
    })
  }

  return (
    <>
      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-borde bg-elevada/50 text-left">
                <Th className="w-[36px]" title="Salud del número">
                  <span className="sr-only">Salud</span>
                </Th>
                <Th className="w-[190px]">Cuenta</Th>
                <Th className="w-[150px]">Identificador</Th>
                <Th className="w-[140px]">Estado</Th>
                <Th className="w-[130px] text-right">Cupo de hoy</Th>
                <Th className="w-[80px] text-right">Respuesta</Th>
                <Th className="w-[80px] text-right">Asignados</Th>
                <Th className="w-[90px] text-right">Contactados</Th>
                <Th className="w-[85px] text-right">Pendientes</Th>
                <Th className="w-[95px] text-right">Días de cola</Th>
                <Th className="w-[110px]">Ventana</Th>
                <Th className="w-[70px]" />
              </tr>
            </thead>
            <tbody>
              {cuentas.map((c) => {
                const meta = ACCOUNT_STATUS_META[c.status]
                const alTope = c.cap > 0 && c.enviados >= c.cap
                const operativa = c.status === 'activa' || c.status === 'calentando'
                return (
                  <tr
                    key={c.id}
                    className={cn(
                      'border-b border-borde/60 transition-colors duration-150 last:border-b-0 hover:bg-elevada/40',
                      !operativa && 'opacity-55',
                    )}
                  >
                    <Td>
                      <span
                        title={c.saludMotivo}
                        aria-label={`Salud ${c.salud}: ${c.saludMotivo}`}
                        className={cn(
                          'block h-2 w-2 rounded-full',
                          c.salud === 'verde' && 'bg-verde',
                          c.salud === 'amarillo' && 'bg-ambar',
                          c.salud === 'rojo' && 'bg-rojo',
                        )}
                      />
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        {c.channel === 'whatsapp' ? (
                          <MessageCircle className="h-3.5 w-3.5 shrink-0 text-verde" aria-label="WhatsApp" />
                        ) : (
                          <Instagram className="h-3.5 w-3.5 shrink-0 text-ambar" aria-label="Instagram" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="dato text-[11.5px] text-texto-2">{c.code}</span>
                            <Chip tono={c.mode === 'api' ? 'activo' : 'neutral'} className="px-1 py-0">
                              {c.mode === 'api' ? 'API' : 'Manual'}
                            </Chip>
                          </div>
                          <div className="truncate font-medium text-texto">{c.label}</div>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <div className="dato text-[11.5px] text-texto-2">
                        {c.channel === 'whatsapp' ? (c.phoneE164 ? `+${c.phoneE164}` : '—') : `@${c.igUsername}`}
                      </div>
                      {c.sessionHint ? (
                        <div className="truncate text-[10.5px] text-texto-2/80">{c.sessionHint}</div>
                      ) : null}
                    </Td>
                    <Td>
                      <select
                        aria-label={`Estado de ${c.code}`}
                        value={c.status}
                        disabled={pendiente}
                        onChange={(e) => cambiarEstado(c, e.target.value as AccountStatus)}
                        className={cn(
                          'h-6 w-full cursor-pointer rounded-[4px] border bg-transparent px-1 text-[11px] font-medium',
                          'transition-colors duration-150 focus:border-ambar focus:outline-none',
                          meta.tone === 'positivo' && 'border-verde/35 bg-verde/12 text-verde',
                          meta.tone === 'activo' && 'border-ambar/35 bg-ambar/12 text-ambar',
                          meta.tone === 'neutral' && 'border-borde bg-elevada text-texto-2',
                          meta.tone === 'negativo' && 'border-rojo/35 bg-rojo/12 text-rojo',
                        )}
                      >
                        {(Object.keys(ACCOUNT_STATUS_META) as AccountStatus[]).map((s) => (
                          <option key={s} value={s} className="bg-elevada text-texto">
                            {ACCOUNT_STATUS_META[s].label}
                          </option>
                        ))}
                      </select>
                      {c.status === 'calentando' && c.warmupDay ? (
                        <Calentamiento
                          dia={c.warmupDay}
                          total={c.warmupTotal}
                          repeticiones={c.warmupRepeats}
                        />
                      ) : c.faltaPreparacion.length > 0 ? (
                        <div
                          className="mt-1 text-[10px] text-texto-2"
                          title={c.faltaPreparacion.join('\n')}
                        >
                          Faltan {c.faltaPreparacion.length} de preparación
                        </div>
                      ) : null}
                    </Td>
                    <Td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <BarraCupo enviados={c.enviados} cap={c.cap} operativa={operativa} />
                        <span className={cn('dato tabular-nums', alTope ? 'text-rojo' : 'text-texto')}>
                          {c.enviados}
                          <span className="text-texto-2">/{c.cap}</span>
                        </span>
                      </div>
                    </Td>
                    <Td className="dato text-right" title={c.saludMotivo}>
                      {c.tasaRespuesta7d === null ? (
                        <span className="text-texto-2">—</span>
                      ) : (
                        <span
                          className={
                            c.tasaRespuesta7d < 0.1
                              ? 'text-rojo'
                              : c.tasaRespuesta7d >= 0.15
                                ? 'text-verde'
                                : 'text-texto'
                          }
                        >
                          {Math.round(c.tasaRespuesta7d * 100)}%
                        </span>
                      )}
                    </Td>
                    <Td className="dato text-right">{c.asignados}</Td>
                    <Td className="dato text-right text-texto-2">{c.contactados}</Td>
                    <Td className="dato text-right">{c.pendientes}</Td>
                    <Td className="dato text-right">
                      {c.diasDeCola == null ? (
                        <span className="text-texto-2">—</span>
                      ) : (
                        <span className={c.diasDeCola > 10 ? 'text-ambar' : 'text-texto'}>
                          {c.diasDeCola} d
                        </span>
                      )}
                    </Td>
                    <Td className="dato text-[11.5px] text-texto-2">
                      {c.windowStart.slice(0, 5)}–{c.windowEnd.slice(0, 5)}
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="fantasma"
                          size="iconoSm"
                          title={`Editar ${c.code}`}
                          aria-label={`Editar ${c.code}`}
                          onClick={() => setEditando(c)}
                        >
                          <Pencil aria-hidden />
                        </Button>
                        <Button
                          variant="fantasma"
                          size="iconoSm"
                          title={`Borrar ${c.code}`}
                          aria-label={`Borrar ${c.code}`}
                          disabled={pendiente}
                          className="hover:text-rojo"
                          onClick={() => borrar(c)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <DialogoCuenta
        abierto={editando !== null}
        onCerrar={() => setEditando(null)}
        cuenta={editando}
      />
    </>
  )
}

/** Avance del calentamiento: día actual sobre el total de la escala. */
function Calentamiento({
  dia,
  total,
  repeticiones,
}: {
  dia: number
  total: number
  repeticiones: number
}) {
  return (
    <div
      className="mt-1 flex items-center gap-1"
      data-calentamiento={`${dia}/${total}`}
      title={
        `Día ${dia} de ${total} del calentamiento.` +
        (repeticiones > 0
          ? `\nRepitió el día ${repeticiones} ${repeticiones === 1 ? 'vez' : 'veces'} por problemas.`
          : '')
      }
    >
      <div className="flex gap-[2px]" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              'block h-[3px] w-[5px] rounded-[1px]',
              i < dia ? 'bg-ambar' : 'bg-borde/55',
            )}
          />
        ))}
      </div>
      <span className="dato text-[10px] text-texto-2">
        día {dia}/{total}
      </span>
      {repeticiones > 0 ? (
        <span className="dato text-[10px] text-rojo" title="Repitió el día por problemas">
          ↻{repeticiones}
        </span>
      ) : null}
    </div>
  )
}

function BarraCupo({ enviados, cap, operativa }: { enviados: number; cap: number; operativa: boolean }) {
  const ratio = cap > 0 ? Math.min(enviados / cap, 1) : 0
  const alTope = cap > 0 && enviados >= cap
  return (
    <div className="h-1.5 w-14 overflow-hidden rounded-[2px] bg-borde/50" aria-hidden>
      <div
        className={cn(
          'h-full transition-[width] duration-200 ease-[cubic-bezier(0.2,0,0,1)]',
          !operativa ? 'bg-texto-2/40' : alTope ? 'bg-rojo' : 'bg-ambar',
        )}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  )
}

function Th({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn('rotulo whitespace-nowrap px-2.5 py-1.5 font-semibold', className)}
      {...props}
    />
  )
}

function Td({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-2.5 py-1.5 align-middle', className)} {...props} />
}

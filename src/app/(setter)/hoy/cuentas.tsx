'use client'

import { Check, Repeat } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Chip, Panel } from '@/components/ui/panel'
import { cn } from '@/lib/utils'
import { confirmarCambioDeCuenta } from '@/server/actions/setter'
import type { PendienteDeCuenta } from '@/server/setters/cola'

/**
 * Las cuentas del setter y qué le falta en cada una.
 *
 * Existe porque el trabajo está separado por cuenta y no se puede mezclar: un
 * seguimiento solo sale de la cuenta que abrió esa conversación. Sin esta
 * vista, el setter no sabe si le conviene seguir donde está o cambiar.
 *
 * Cambiar de cuenta en Instagram desde el celular es lento, así que la idea es
 * terminar todo lo de una antes de pasar a la siguiente. Por eso se muestra
 * cuánto queda en cada una: para decidir una vez, no veinte.
 */
export function Cuentas({
  cuentas,
  onCambio,
}: {
  cuentas: PendienteDeCuenta[]
  onCambio: () => void
}) {
  const [pendiente, iniciar] = React.useTransition()

  // Con una sola cuenta no hay nada que elegir: el medidor de arriba alcanza.
  if (cuentas.length < 2) return null

  function cambiar(cuentaId: string, usuario: string): void {
    iniciar(async () => {
      const r = await confirmarCambioDeCuenta(cuentaId)
      if (r.ok) {
        toast.success(`Ahora estás con @${usuario}`)
        onCambio()
      } else {
        toast.error(r.error ?? 'No se pudo cambiar de cuenta.')
      }
    })
  }

  return (
    <Panel>
      <div className="border-b border-borde px-3 py-2">
        <p className="text-[13px] font-medium text-texto">Tus cuentas</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-texto-2">
          Los seguimientos salen de la cuenta que abrió cada conversación, y no gastan cupo. El
          número de arriba es solo de chats nuevos. Terminá una cuenta antes de pasar a la otra.
        </p>
      </div>

      <div className="divide-y divide-borde">
        {cuentas.map((c) => (
          <div
            key={c.cuentaId}
            className={cn(
              'flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5',
              c.activa && 'bg-acento-tenue',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="dato truncate text-[13.5px] text-texto">@{c.igUsername}</span>
                {c.activa ? <Chip tono="activo">trabajando acá</Chip> : null}
                {c.restante === 0 ? <Chip tono="negativo">al tope</Chip> : null}
              </div>
              <p className="mt-0.5 text-[11.5px] text-texto-2">
                <span className="dato">
                  {c.usadoHoy}/{c.cupoDiario}
                </span>{' '}
                chats abiertos
                {/*
                  Las dos listas también acá, y por separado. Los seguimientos de
                  esta cuenta salen igual aunque esté al tope; los reintentos de
                  apertura no, porque descuentan del mismo cupo que ya se acabó.
                */}
                {c.seguimientos > 0 ? (
                  <>
                    {' · '}
                    <span className="dato text-verde">{c.seguimientos}</span>{' '}
                    {c.seguimientos === 1 ? 'seguimiento' : 'seguimientos'}
                  </>
                ) : (
                  ' · sin seguimientos'
                )}
                {c.aperturas > 0 ? (
                  <>
                    {' · '}
                    <span className={cn('dato', c.restante > 0 ? 'text-ambar' : 'text-rojo')}>
                      {c.aperturas}
                    </span>{' '}
                    por reabrir
                    {c.restante === 0 ? ' para mañana' : ''}
                  </>
                ) : null}
              </p>
            </div>

            {c.activa ? (
              <span className="flex items-center gap-1 text-[12px] text-acento">
                <Check className="h-3.5 w-3.5" aria-hidden />
                activa
              </span>
            ) : (
              <Button
                variant="secundaria"
                size="sm"
                disabled={pendiente || c.restante === 0}
                onClick={() => cambiar(c.cuentaId, c.igUsername)}
                title={
                  c.restante === 0
                    ? 'Esta cuenta llegó a su límite de hoy'
                    : `Cambiar a @${c.igUsername}`
                }
              >
                <Repeat aria-hidden />
                Usar esta
              </Button>
            )}
          </div>
        ))}
      </div>
    </Panel>
  )
}

'use client'

import { CalendarPlus, Flame, HelpCircle, MessageSquare, ThumbsDown, Wallet } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Chip, Panel } from '@/components/ui/panel'
import { STAGE_META, type ContactStage } from '@/db/enums'
import { formatearTelefono } from '@/lib/phone-ar'
import { haceCuanto } from '@/lib/tz'
import { cn } from '@/lib/utils'
import type { FilaRespondio } from '@/server/contacts'
import { clasificar } from '@/server/actions/contacts'

/**
 * Bandeja de los que contestaron.
 *
 * Un click por contacto y listo. Es la acción que más se repite en el día, así
 * que no pide confirmación ni abre diálogos: clasificás y desaparece de la
 * lista.
 */

const CLASIFICACIONES: Array<{
  etapa: ContactStage
  label: string
  icono: typeof Flame
  variante: 'positiva' | 'secundaria' | 'destructiva'
  ayuda: string
}> = [
  {
    etapa: 'interesado',
    label: 'Interesado',
    icono: Flame,
    variante: 'positiva',
    ayuda: 'Quiere avanzar. Es el que hay que llamar hoy.',
  },
  {
    etapa: 'reunion_agendada',
    label: 'Reunión',
    icono: CalendarPlus,
    variante: 'positiva',
    ayuda: 'Ya quedaron en hablar.',
  },
  {
    etapa: 'respondido',
    label: 'Duda',
    icono: HelpCircle,
    variante: 'secundaria',
    ayuda: 'Preguntó algo y hay que contestarle. Queda en la bandeja.',
  },
  {
    etapa: 'respondido',
    label: 'Precio',
    icono: Wallet,
    variante: 'secundaria',
    ayuda: 'Preguntó cuánto sale. Es buena señal.',
  },
  {
    etapa: 'sin_respuesta',
    label: 'No ahora',
    icono: MessageSquare,
    variante: 'secundaria',
    ayuda: 'No es el momento. Vuelve a la cola en 60 días.',
  },
  {
    etapa: 'perdido',
    label: 'No',
    icono: ThumbsDown,
    variante: 'destructiva',
    ayuda: 'Dijo que no. Se cierra.',
  },
]

export function Bandeja({ filas }: { filas: FilaRespondio[] }) {
  const [ocultos, setOcultos] = React.useState<Set<string>>(new Set())
  const [pendiente, iniciar] = React.useTransition()

  const visibles = filas.filter((f) => !ocultos.has(f.id))

  function aplicar(f: FilaRespondio, etapa: ContactStage, label: string) {
    // 'Duda' y 'Precio' dejan el contacto en la bandeja a propósito: todavía
    // hay algo que contestar.
    const quedaEnBandeja = etapa === 'respondido'
    if (!quedaEnBandeja) setOcultos((s) => new Set(s).add(f.id))

    iniciar(async () => {
      const r = await clasificar(f.id, etapa)
      if (r.ok) toast.success(`${f.businessName}: ${label.toLowerCase()}`)
      else {
        setOcultos((s) => {
          const n = new Set(s)
          n.delete(f.id)
          return n
        })
        toast.error(r.error ?? 'No se pudo clasificar.')
      }
    })
  }

  if (visibles.length === 0) {
    return (
      <Panel className="px-6 py-14 text-center">
        <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-[5px] border border-verde/35 bg-verde/10">
          <MessageSquare className="h-4 w-4 text-verde" aria-hidden />
        </div>
        <h2 className="text-[15px]">
          {filas.length > 0 ? 'Clasificaste todo' : 'Nadie está esperando respuesta'}
        </h2>
        <p className="mt-1.5 text-[12.5px] text-texto-2">
          {filas.length > 0
            ? 'No quedó ninguno sin clasificar.'
            : 'Cuando alguien conteste, aparece acá para que lo clasifiques en un click.'}
        </p>
      </Panel>
    )
  }

  return (
    <div className="space-y-2">
      {visibles.map((f) => (
        <Panel key={f.id} className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-[14px] font-medium">{f.businessName}</span>
                <Chip tono={STAGE_META[f.stage].tone}>{STAGE_META[f.stage].label}</Chip>
                {f.esperandoHoras >= 24 ? (
                  <Chip tono="negativo">esperando {Math.floor(f.esperandoHoras / 24)} d</Chip>
                ) : f.esperandoHoras >= 4 ? (
                  <Chip tono="activo">esperando {f.esperandoHoras} h</Chip>
                ) : null}
              </div>
              <p className="mt-0.5 text-[12px] text-texto-2">
                {f.contactName ?? 'Sin nombre'}
                {f.niche ? ` · ${f.niche}` : ''}
                {f.city ? ` · ${f.city}` : ''}
                {' · '}
                <span className="dato">{formatearTelefono(f.phoneE164)}</span>
              </p>
            </div>
            <div className="text-right text-[11px] text-texto-2">
              <div className="dato text-[16px] leading-none text-texto">{f.score}</div>
              <div className="mt-0.5">contestó {haceCuanto(f.lastInboundAt)}</div>
            </div>
          </div>

          {f.ultimoMensaje ? (
            <blockquote className="mx-3 mb-2 border-l-2 border-verde/50 bg-verde/5 px-2.5 py-1.5 text-[12.5px] leading-relaxed text-texto">
              {f.ultimoMensaje}
            </blockquote>
          ) : (
            <p className="mx-3 mb-2 text-[11.5px] text-texto-2">
              Contestó, pero no quedó registrado qué dijo.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1 border-t border-borde bg-elevada/30 px-3 py-1.5">
            <span className="rotulo mr-1">Clasificar</span>
            {CLASIFICACIONES.map((c) => (
              <Button
                key={c.label}
                variant={c.variante}
                size="sm"
                disabled={pendiente}
                title={c.ayuda}
                onClick={() => aplicar(f, c.etapa, c.label)}
              >
                <c.icono aria-hidden />
                {c.label}
              </Button>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  )
}

/** Botón para marcar a mano que alguien contestó, desde cualquier lista. */
export function BotonContesto({
  contactId,
  nombre,
  onHecho,
}: {
  contactId: string
  nombre: string
  onHecho?: () => void
}) {
  const [pendiente, iniciar] = React.useTransition()
  const [abierto, setAbierto] = React.useState(false)
  const [texto, setTexto] = React.useState('')

  if (!abierto) {
    return (
      <Button variant="positiva" size="sm" onClick={() => setAbierto(true)}>
        <MessageSquare aria-hidden />
        Contestó
      </Button>
    )
  }

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault()
        iniciar(async () => {
          const { marcarQueContesto } = await import('@/server/actions/contacts')
          const r = await marcarQueContesto(contactId, texto)
          if (r.ok) {
            toast.success(`${nombre} pasó a Respondió — se cortó la secuencia`)
            setAbierto(false)
            setTexto('')
            onHecho?.()
          } else toast.error(r.error ?? 'No se pudo registrar.')
        })
      }}
    >
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Qué dijo (opcional)"
        autoFocus
        className={cn(
          'h-6 w-48 rounded-[4px] border border-borde bg-fondo px-1.5 text-[11.5px]',
          'focus:border-ambar focus:outline-none',
        )}
      />
      <Button type="submit" variant="positiva" size="sm" disabled={pendiente}>
        Guardar
      </Button>
      <Button type="button" variant="fantasma" size="sm" onClick={() => setAbierto(false)}>
        Cancelar
      </Button>
    </form>
  )
}

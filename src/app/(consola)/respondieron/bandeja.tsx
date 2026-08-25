'use client'

import {
  CalendarPlus,
  ExternalLink,
  Flame,
  HelpCircle,
  MessageSquare,
  ThumbsDown,
  Wallet,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Chip, Panel, PanelHeader } from '@/components/ui/panel'
import { INTERES_META, STAGE_META, type ContactStage } from '@/db/enums'
import { formatearTelefono } from '@/lib/phone-ar'
import { RESPUESTA_VISTA_META, type Respuesta } from '@/lib/respuestas-vistas'
import { haceCuanto } from '@/lib/tz'
import { cn } from '@/lib/utils'
import { clasificar } from '@/server/actions/contacts'
import type { RespuestaDetallada } from '@/server/setters/respuestas'

/**
 * El detalle de cada respuesta.
 *
 * Acá está todo etiquetado: quién lo contactó y cuándo, a qué mensaje contestó,
 * qué dijo exactamente —lo que anotó el setter, que es obligatorio al responder
 * la oferta— y si está interesado de verdad. Es la pantalla del detalle; el
 * vistazo de arriba es el control de seguimientos.
 *
 * Clasificar es un click y sin confirmación: es lo que más se repite en el día.
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

export function Bandeja({
  vista,
  filas,
  base,
  /** En la pantalla de un setter el nombre ya está en el título. */
  conNombreDelSetter = true,
}: {
  vista: Respuesta
  filas: RespuestaDetallada[]
  base: string
  conNombreDelSetter?: boolean
}) {
  const router = useRouter()
  const [ocultos, setOcultos] = React.useState<Set<string>>(new Set())
  const [pendiente, iniciar] = React.useTransition()

  const meta = RESPUESTA_VISTA_META[vista]
  const visibles = filas.filter((f) => !ocultos.has(f.id))

  function aplicar(f: RespuestaDetallada, etapa: ContactStage, label: string): void {
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

  return (
    <Panel className="border-acento/35">
      <PanelHeader
        titulo={meta.label}
        descripcion={meta.detalle}
        acciones={
          <button
            onClick={() => router.push(base as never, { scroll: false })}
            aria-label="Cerrar la lista"
            className="flex h-7 w-7 items-center justify-center rounded-[5px] text-texto-2 hover:bg-elevada hover:text-texto"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        }
      />

      {visibles.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13px] text-texto-2">
          {filas.length > 0 ? 'Clasificaste todo.' : meta.vacio}
        </p>
      ) : (
        <div className="divide-y divide-borde">
          {visibles.map((f) => (
            <div key={f.id} className="px-3 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-[14px] font-medium">{f.businessName}</span>

                    {/* Una sola etiqueta y solo cuando dice algo: el sí o el no
                        a la oferta. Sin etiqueta = contestó la entrada. */}
                    {f.respondioA === 'segundo' && f.interes ? (
                      <Chip tono={INTERES_META[f.interes].tone}>
                        {INTERES_META[f.interes].label}
                      </Chip>
                    ) : f.stage !== 'respondido' ? (
                      <Chip tono={STAGE_META[f.stage].tone}>{STAGE_META[f.stage].label}</Chip>
                    ) : null}

                    {f.esperandoHoras >= 24 ? (
                      <Chip tono="negativo">
                        esperando {Math.floor(f.esperandoHoras / 24)} d
                      </Chip>
                    ) : f.esperandoHoras >= 4 ? (
                      <Chip tono="activo">esperando {f.esperandoHoras} h</Chip>
                    ) : null}
                  </div>

                  <p className="mt-0.5 text-[12px] text-texto-2">
                    {f.contactName ?? 'Sin nombre'}
                    {f.niche ? ` · ${f.niche}` : ''}
                    {f.city ? ` · ${f.city}` : ''}
                    {f.phoneE164 ? (
                      <>
                        {' · '}
                        <span className="dato">{formatearTelefono(f.phoneE164)}</span>
                      </>
                    ) : null}
                    {f.respondioA === 'primero' ? (
                      <span className="text-ambar"> · le falta la oferta</span>
                    ) : null}
                  </p>

                  {/* Quién lo contactó y cuándo: es el dato de la comisión. */}
                  <p className="mt-0.5 text-[11.5px] text-texto-2">
                    {conNombreDelSetter && f.setterNombre
                      ? `Lo contactó ${f.setterNombre}`
                      : 'Contactado'}
                    {f.contactadoAt ? ` ${haceCuanto(f.contactadoAt)}` : ''}
                    {f.respondidoAt ? ` · contestó ${haceCuanto(f.respondidoAt)}` : ''}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right text-[11px] text-texto-2">
                    <div className="dato text-[16px] leading-none text-texto">{f.score}</div>
                    <div className="mt-0.5">puntaje</div>
                  </div>
                  {f.igUsername ? (
                    <a
                      href={`https://ig.me/m/${f.igUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Abrir el chat con ${f.businessName}`}
                      className="flex h-7 w-7 items-center justify-center rounded-[5px] text-texto-2 hover:bg-elevada hover:text-texto"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  ) : null}
                </div>
              </div>

              {/* Lo que anotó el setter al marcar la respuesta a la oferta. Es
                  obligatorio, así que en esos casos siempre hay algo. */}
              {f.notaDelSetter ? (
                <blockquote className="mt-2 border-l-2 border-acento/50 bg-acento-tenue px-2.5 py-1.5 text-[12.5px] leading-relaxed text-texto">
                  {f.notaDelSetter}
                  {f.setterNombre ? (
                    <span className="ml-1 text-texto-2">— anotó {f.setterNombre}</span>
                  ) : null}
                </blockquote>
              ) : null}

              {f.ultimoMensaje ? (
                <blockquote className="mt-2 border-l-2 border-verde/50 bg-verde-tenue px-2.5 py-1.5 text-[12.5px] leading-relaxed text-texto">
                  {f.ultimoMensaje}
                </blockquote>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center gap-1">
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
            </div>
          ))}
        </div>
      )}

      {filas.length >= 500 ? (
        <p className={cn('border-t border-borde px-4 py-2 text-[11.5px] text-texto-2')}>
          Se muestran los primeros 500.
        </p>
      ) : null}
    </Panel>
  )
}

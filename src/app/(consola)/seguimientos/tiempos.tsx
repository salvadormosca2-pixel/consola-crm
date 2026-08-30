'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { GRUPOS_DE_PASOS, PASO_META, type Paso } from '@/lib/mensajes-config'
import { cn } from '@/lib/utils'
import { guardarTiempos } from '@/server/actions/mensajes'

/**
 * Cuándo vuelve un lead, y con cuál de las situaciones.
 *
 * Esta pantalla es **el tiempo**; el texto que sale en cada situación se
 * escribe en Mensajes. Son dos decisiones distintas y se toman en momentos
 * distintos: los días se tocan una vez y quedan, y los textos se reescriben
 * todo el tiempo según qué contesta la gente.
 *
 * Lo que las mantiene unidas es esta lista: cada situación muestra si ya tiene
 * mensaje escrito, y si no lo tiene se entra a escribirlo desde acá.
 */

export interface TiemposDeSeguimiento {
  horasSegundoMensaje: number
  horasVencimiento: number
  diasAtrasoParaAlerta: number
  diasParaUltimoIntento: number
  diasParaRetomarConversacion: number
  diasParaRetomarInteresado: number
  diasParaUltimoReenganche: number
}

/** Solo lo que la escalera necesita saber de los textos: si están o no. */
export interface EstadoDeMensajes {
  escritos: Paso[]
}

export function Tiempos({
  tiempos,
  mensajes,
}: {
  tiempos: TiemposDeSeguimiento
  mensajes: EstadoDeMensajes
}) {
  const reloj = useTiempos(tiempos)
  const escritos = new Set(mensajes.escritos)

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[22px]">Seguimientos</h1>
        <p className="mt-1 max-w-[720px] text-[13px] leading-relaxed text-texto-2">
          Cuándo vuelve un lead a la cola del setter, y con cuál de las situaciones. Un seguimiento
          no sale por orden de lista: sale por los días que pasaron y por la situación en la que
          quedó el lead. Acá se define esa escalera; el texto de cada una se escribe en{' '}
          <Link href="/mensajes" className="text-acento hover:underline">
            Mensajes
          </Link>
          .
        </p>
      </div>

      <Escalera reloj={reloj} escritos={escritos} />
      <Generales reloj={reloj} />
    </div>
  )
}

/* ── Qué dispara cada situación ───────────────────────────────────────── */

type ClaveDeEspera = Exclude<keyof TiemposDeSeguimiento, 'horasVencimiento' | 'diasAtrasoParaAlerta'>

interface Disparo {
  /** En qué situación tiene que estar el lead para que le toque este mensaje. */
  situacion: string
  espera: { campo: ClaveDeEspera; unidad: string; desde: string; min: number; max: number } | null
}

const DISPARO: Record<Paso, Disparo> = {
  1: {
    situacion: 'Le cayó a un setter y todavía no recibió nada.',
    espera: null,
  },
  2: {
    situacion: 'Recibió la entrada y no contestó. Si contesta antes, este le toca en el acto.',
    espera: {
      campo: 'horasSegundoMensaje',
      unidad: 'horas',
      desde: 'después de la entrada',
      min: 1,
      max: 240,
    },
  },
  3: {
    situacion: 'Recibió los dos y nunca dijo nada. Es el último: después de este no se insiste más.',
    espera: {
      campo: 'diasParaUltimoIntento',
      unidad: 'días',
      desde: 'después de la oferta',
      min: 1,
      max: 60,
    },
  },
  4: {
    situacion: 'Había contestado, se estuvo hablando, y después desapareció.',
    espera: {
      campo: 'diasParaRetomarConversacion',
      unidad: 'días',
      desde: 'sin novedad',
      min: 1,
      max: 90,
    },
  },
  5: {
    situacion: 'Dijo que le interesaba la oferta y después dejó de contestar.',
    espera: {
      campo: 'diasParaRetomarInteresado',
      unidad: 'días',
      desde: 'sin novedad',
      min: 1,
      max: 90,
    },
  },
  6: {
    situacion: 'El setter marcó que contestó la oferta y que le interesa.',
    espera: null,
  },
  7: {
    situacion: 'El setter marcó que contestó la oferta y que no le interesa.',
    espera: null,
  },
  8: {
    situacion: 'El setter cargó la reunión.',
    espera: null,
  },
  9: {
    situacion: 'Ya recibió un reenganche y tampoco contestó. Es el último de todos.',
    espera: {
      campo: 'diasParaUltimoReenganche',
      unidad: 'días',
      desde: 'del reenganche anterior',
      min: 1,
      max: 120,
    },
  },
}

/**
 * Los seis números, en un solo estado.
 *
 * Se guardan todos juntos porque son una sola configuración: editar los días
 * de una etapa desde su pestaña y el vencimiento desde abajo tiene que llegar
 * al mismo lugar sin pisarse.
 */
type Reloj = ReturnType<typeof useTiempos>

function useTiempos(inicial: TiemposDeSeguimiento) {
  const router = useRouter()
  const [valores, setValores] = React.useState<Record<keyof TiemposDeSeguimiento, string>>(
    () =>
      Object.fromEntries(Object.entries(inicial).map(([k, v]) => [k, String(v)])) as Record<
        keyof TiemposDeSeguimiento,
        string
      >,
  )
  const [pendiente, iniciar] = React.useTransition()

  const claves = Object.keys(inicial) as Array<keyof TiemposDeSeguimiento>
  const cambiado = claves.some((k) => Number(valores[k]) !== inicial[k])

  function guardar(): void {
    iniciar(async () => {
      const r = await guardarTiempos(
        Object.fromEntries(claves.map((k) => [k, Number(valores[k])])),
      )
      if (r.ok) {
        toast.success('Guardado')
        router.refresh()
      } else toast.error(r.error ?? 'No se pudo guardar.')
    })
  }

  return {
    valores,
    inicial,
    pendiente,
    cambiado,
    guardar,
    poner: (k: keyof TiemposDeSeguimiento, v: string) =>
      setValores((prev) => ({ ...prev, [k]: v })),
  }
}

/**
 * El botón que guarda todos los números de una, esté donde esté el que tocaste.
 *
 * Son una sola configuración aunque estén repartidos en dos paneles: mover los
 * días de una situación y el vencimiento en la misma pasada tiene que llegar
 * junto, sin que uno pise al otro.
 */
function GuardarTiempos({ reloj, className }: { reloj: Reloj; className?: string }) {
  return (
    <Button
      variant="primaria"
      className={className}
      disabled={reloj.pendiente || !reloj.cambiado}
      onClick={reloj.guardar}
    >
      {reloj.pendiente ? 'Guardando…' : 'Guardar'}
    </Button>
  )
}

/* ── La escalera ──────────────────────────────────────────────────────── */

/**
 * Las situaciones en orden, con sus días editables en la misma fila.
 *
 * Una fila por situación y todo lo suyo ahí: cuánto espera, qué la dispara, y
 * si ya tiene mensaje. Es la pantalla que faltaba — antes los días vivían en un
 * panel de configuración y nunca se veía la escalera entera.
 */
function Escalera({ reloj, escritos }: { reloj: Reloj; escritos: Set<Paso> }) {
  return (
    <Panel>
      <PanelHeader
        titulo="Cómo vuelve un lead"
        descripcion="Cada situación en la que puede quedar, y cuánto se espera antes de escribirle."
        acciones={<GuardarTiempos reloj={reloj} />}
      />
      {GRUPOS_DE_PASOS.map((grupo) => (
        <div key={grupo.titulo} className="border-t border-borde">
          <div className="bg-elevada px-3 py-1.5">
            <p className="text-[12px] font-medium text-texto">{grupo.titulo}</p>
            <p className="text-[11.5px] leading-relaxed text-texto-2">{grupo.detalle}</p>
          </div>
          <ol className="divide-y divide-borde/60">
            {grupo.pasos.map((p) => {
              const espera = DISPARO[p].espera
              return (
                <li key={p} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
                  <div className="w-[136px] shrink-0">
                    {espera ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          min={espera.min}
                          max={espera.max}
                          aria-label={`Días u horas de "${PASO_META[p].label}"`}
                          className="w-[68px]"
                          value={reloj.valores[espera.campo]}
                          onChange={(e) => reloj.poner(espera.campo, e.target.value)}
                        />
                        <span className="text-[12px] text-texto-2">{espera.unidad}</span>
                      </div>
                    ) : (
                      <span className="dato text-[12px] text-acento">en el acto</span>
                    )}
                    {espera ? (
                      <p className="mt-0.5 text-[11px] leading-tight text-texto-2">
                        {espera.desde}
                      </p>
                    ) : null}
                  </div>

                  <div className="min-w-[220px] flex-1">
                    <p className="text-[13px] font-medium text-texto">{PASO_META[p].label}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-texto-2">
                      {DISPARO[p].situacion}
                    </p>
                  </div>

                  {/* El estado del texto, y la puerta para ir a escribirlo. Sin
                      mensaje esta situación no se puede trabajar, así que el
                      dato tiene que estar acá y no a dos pantallas. */}
                  <Link
                    href={`/mensajes?situacion=${p}`}
                    className={cn(
                      'flex h-7.5 shrink-0 items-center gap-1.5 rounded-[5px] border px-2.5 text-[12px]',
                      escritos.has(p)
                        ? 'border-borde bg-elevada text-texto-2 hover:text-texto'
                        : 'border-rojo/40 bg-rojo-tenue text-rojo',
                    )}
                  >
                    {escritos.has(p) ? 'Ver el mensaje' : 'Falta el mensaje'}
                  </Link>
                </li>
              )
            })}
          </ol>
        </div>
      ))}
      <p className="border-t border-borde px-3 py-2 text-[11.5px] leading-relaxed text-texto-2">
        Una situación sin mensaje escrito no se puede trabajar: los leads que caen ahí le quedan
        bloqueados al setter con el motivo a la vista.
      </p>
    </Panel>
  )
}

function Generales({ reloj }: { reloj: Reloj }) {
  return (
    <Panel>
      <PanelHeader
        titulo="Vencimiento y alertas"
        descripcion="No son de ninguna situación en particular: valen para toda la operación."
      />
      <div className="flex flex-wrap items-end gap-3 px-4 py-4">
        <Field label="Un lead vence a las" className="w-[150px]">
          <Input
            type="number"
            min={1}
            max={720}
            value={reloj.valores.horasVencimiento}
            onChange={(e) => reloj.poner('horasVencimiento', e.target.value)}
          />
        </Field>
        <span className="pb-2 text-[13px] text-texto-2">horas sin trabajarlo</span>

        <Field label="Me avisás con" className="w-[150px]">
          <Input
            type="number"
            min={1}
            max={30}
            value={reloj.valores.diasAtrasoParaAlerta}
            onChange={(e) => reloj.poner('diasAtrasoParaAlerta', e.target.value)}
          />
        </Field>
        <span className="pb-2 text-[13px] text-texto-2">días de atraso</span>

        <GuardarTiempos reloj={reloj} className="mb-0.5" />
      </div>

      <p className="border-t border-borde px-4 py-3 text-[12.5px] leading-relaxed text-texto-2">
        Si el setter no manda el primero en {reloj.valores.horasVencimiento} h, el lead vuelve solo
        al pozo y se le reparte a otro. Un lead ya contactado nunca vence: los seguimientos que le
        quedan siguen siendo suyos. Y si la conversación sigue viva, el seguimiento se cancela desde
        la bandeja.
      </p>
    </Panel>
  )
}

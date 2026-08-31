'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { MensajesDeLaSituacion, Variables } from '@/components/mensaje-editable'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Panel, PanelHeader } from '@/components/ui/panel'
import {
  esDeSeguimiento,
  GRUPOS_DE_PASOS,
  PASO_META,
  PASOS_DE_SEGUIMIENTO,
  type MensajesConfig,
  type Paso,
} from '@/lib/mensajes-config'
import { cn } from '@/lib/utils'
import { guardarTiempos } from '@/server/actions/mensajes'
import type { MensajeGuardado } from '@/server/setters/mensajes'

/**
 * Los seguimientos: cuándo vuelve un lead, y con qué texto.
 *
 * Las dos cosas viven acá porque son una sola decisión. El texto de un
 * seguimiento no se puede escribir sin el día delante: a los tres días le
 * preguntás si llegó a ver el mensaje, a los quince ya no preguntás nada y le
 * dejás la puerta abierta. Tenerlos en pantallas separadas obligaba a escribir
 * a ciegas y a cruzar de una a la otra para acordarse del número.
 *
 * Los mensajes que **no** son un seguimiento —la entrada, la oferta y los tres
 * que salen en el acto cuando el setter marca qué contestó— no dependen de
 * ningún día y se escriben en Mensajes.
 *
 * La escalera de arriba sigue mostrando las nueve situaciones, de seguimiento o
 * no: un seguimiento sale por los días que pasaron y por dónde quedó el lead, y
 * eso solo se entiende viendo el recorrido entero.
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

export function Tiempos({
  tiempos,
  mensajes,
  config,
  rubros,
}: {
  tiempos: TiemposDeSeguimiento
  /** Todos los guardados. Acá se usan los de seguimiento y se mira si el resto está escrito. */
  mensajes: MensajeGuardado[]
  config: MensajesConfig
  rubros: Array<{ rubro: string; leads: number }>
}) {
  const reloj = useTiempos(tiempos)
  const [paso, setPaso] = React.useState<Paso>(PASOS_DE_SEGUIMIENTO[0]!)
  const textos = React.useRef<HTMLDivElement>(null)

  const escritos = new Set(
    mensajes.filter((m) => m.rubro === null && m.activo).map((m) => m.paso),
  )

  /* Tocar un seguimiento en la escalera lleva a su texto, que está más abajo en
     esta misma pantalla. Los que no son seguimiento siguen yendo a Mensajes. */
  function irAlTexto(p: Paso): void {
    setPaso(p)
    textos.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[22px]">Seguimientos</h1>
        <p className="mt-1 max-w-[720px] text-[13px] leading-relaxed text-texto-2">
          Cuándo vuelve un lead a la cola del setter, con cuál de las situaciones, y qué le decimos
          en cada una. Un seguimiento no sale por orden de lista: sale por los días que pasaron y
          por la situación en la que quedó el lead. Los mensajes que no son seguimiento —la entrada,
          la oferta y los que salen en el acto— se escriben en{' '}
          <Link href="/mensajes" className="text-acento hover:underline">
            Mensajes
          </Link>
          .
        </p>
      </div>

      <Escalera reloj={reloj} escritos={escritos} irAlTexto={irAlTexto} />

      <TextosDeSeguimiento
        ancla={textos}
        reloj={reloj}
        paso={paso}
        elegir={setPaso}
        mensajes={mensajes}
        config={config}
        rubros={rubros}
        escritos={escritos}
      />

      <Generales reloj={reloj} />
    </div>
  )
}

/* ── Qué dispara cada situación ───────────────────────────────────────── */

type ClaveDeEspera = Exclude<keyof TiemposDeSeguimiento, 'horasVencimiento' | 'diasAtrasoParaAlerta'>

interface Espera {
  campo: ClaveDeEspera
  unidad: string
  desde: string
  min: number
  max: number
}

interface Disparo {
  /** En qué situación tiene que estar el lead para que le toque este mensaje. */
  situacion: string
  espera: Espera | null
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
 * Son una sola configuración aunque estén repartidos en varios paneles: mover
 * los días de una situación y el vencimiento en la misma pasada tiene que
 * llegar junto, sin que uno pise al otro.
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

/** El número de días u horas de una situación, editable donde se lo muestre. */
function CampoDeEspera({
  reloj,
  espera,
  etiqueta,
}: {
  reloj: Reloj
  espera: Espera
  etiqueta: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        min={espera.min}
        max={espera.max}
        aria-label={etiqueta}
        className="w-[68px]"
        value={reloj.valores[espera.campo]}
        onChange={(e) => reloj.poner(espera.campo, e.target.value)}
      />
      <span className="text-[12px] text-texto-2">{espera.unidad}</span>
    </div>
  )
}

/* ── La escalera ──────────────────────────────────────────────────────── */

/**
 * Las situaciones en orden, con sus días editables en la misma fila.
 *
 * Están las nueve, sean seguimiento o no: el recorrido del lead es uno solo y
 * cortarlo por la mitad haría imposible ver cuánto tarda de punta a punta. Lo
 * que cambia es adónde lleva el botón del texto — el de un seguimiento baja a
 * escribirlo acá mismo, el del resto va a Mensajes.
 */
function Escalera({
  reloj,
  escritos,
  irAlTexto,
}: {
  reloj: Reloj
  escritos: Set<Paso>
  irAlTexto: (p: Paso) => void
}) {
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
              const cargado = escritos.has(p)
              const claseTexto = cn(
                'flex h-7.5 shrink-0 items-center gap-1.5 rounded-[5px] border px-2.5 text-[12px]',
                cargado
                  ? 'border-borde bg-elevada text-texto-2 hover:text-texto'
                  : 'border-rojo/40 bg-rojo-tenue text-rojo',
              )
              return (
                <li key={p} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
                  <div className="w-[136px] shrink-0">
                    {espera ? (
                      <CampoDeEspera
                        reloj={reloj}
                        espera={espera}
                        etiqueta={`Días u horas de "${PASO_META[p].label}"`}
                      />
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
                  {esDeSeguimiento(p) ? (
                    <button type="button" onClick={() => irAlTexto(p)} className={claseTexto}>
                      {cargado ? 'Ver el mensaje' : 'Falta el mensaje'}
                    </button>
                  ) : (
                    <Link href={`/mensajes?situacion=${p}`} className={claseTexto}>
                      {cargado ? 'Ver el mensaje' : 'Falta el mensaje'}
                    </Link>
                  )}
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

/* ── El texto de cada seguimiento ─────────────────────────────────────── */

/**
 * Los cuatro seguimientos, uno a la vez, con el día arriba del texto.
 *
 * El día está en la pestaña y otra vez al lado del cuadro de escribir, y es el
 * mismo número de la escalera: cambiarlo desde acá es cambiarlo allá. Está
 * repetido a propósito — es el dato que decide cómo se redacta, y mandarte a
 * buscarlo arriba cada vez es lo que hacía que se escribiera a ojo.
 */
function TextosDeSeguimiento({
  ancla,
  reloj,
  paso,
  elegir,
  mensajes,
  config,
  rubros,
  escritos,
}: {
  ancla: React.RefObject<HTMLDivElement | null>
  reloj: Reloj
  paso: Paso
  elegir: (p: Paso) => void
  mensajes: MensajeGuardado[]
  config: MensajesConfig
  rubros: Array<{ rubro: string; leads: number }>
  escritos: Set<Paso>
}) {
  const espera = DISPARO[paso].espera

  return (
    <div ref={ancla} className="space-y-3 scroll-mt-16">
      <div className="pt-2">
        <h2 className="text-[17px] font-semibold text-texto">Qué le decimos en cada seguimiento</h2>
        <p className="mt-1 max-w-[720px] text-[13px] leading-relaxed text-texto-2">
          Un texto por seguimiento, escrito para el día en que le llega. A los pocos días conviene
          preguntar si llegó a verlo; al último ya no se pregunta nada, se deja la puerta abierta.
          Por eso el día está acá arriba y no en otra pantalla.
        </p>
      </div>

      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Seguimientos">
        {PASOS_DE_SEGUIMIENTO.map((p) => {
          const suEspera = DISPARO[p].espera
          return (
            <button
              key={p}
              onClick={() => elegir(p)}
              aria-current={paso === p ? 'page' : undefined}
              className={cn(
                'flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] border px-3 text-[13px] font-medium',
                'transition-colors duration-150',
                paso === p
                  ? 'border-acento/40 bg-acento-tenue text-acento'
                  : 'border-borde bg-superficie text-texto-2 hover:text-texto',
              )}
            >
              {/* El día en la pestaña: es lo que distingue un seguimiento de
                  otro más que el nombre. */}
              {suEspera ? (
                <span className="dato text-[12px] opacity-80">
                  {reloj.valores[suEspera.campo]} {suEspera.unidad}
                </span>
              ) : null}
              {PASO_META[p].label}
              {!escritos.has(p) ? (
                <span className="h-1.5 w-1.5 rounded-full bg-rojo" aria-label="sin cargar" />
              ) : null}
            </button>
          )
        })}
      </nav>

      <Panel className="border-borde bg-elevada">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-3">
          {espera ? (
            <div>
              <div className="rotulo mb-1">Sale a los</div>
              <CampoDeEspera
                reloj={reloj}
                espera={espera}
                etiqueta={`Días de "${PASO_META[paso].label}"`}
              />
              <p className="mt-0.5 text-[11px] leading-tight text-texto-2">{espera.desde}</p>
            </div>
          ) : null}

          <div className="min-w-[260px] flex-1">
            <div className="rotulo mb-1">A quién le llega</div>
            <p className="text-[13px] font-medium text-texto">{DISPARO[paso].situacion}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-texto-2">
              {PASO_META[paso].objetivo}
            </p>
          </div>

          <GuardarTiempos reloj={reloj} className="mt-4" />
        </div>
      </Panel>

      <MensajesDeLaSituacion paso={paso} mensajes={mensajes} config={config} rubros={rubros} />

      <Variables />
    </div>
  )
}

/* ── Vencimiento y alertas ────────────────────────────────────────────── */

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

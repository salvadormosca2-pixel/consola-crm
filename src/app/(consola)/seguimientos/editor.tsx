'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Chip, Panel, PanelHeader } from '@/components/ui/panel'
import {
  GRUPOS_DE_PASOS,
  PASO_META,
  VARIABLES_DISPONIBLES,
  type MensajesConfig,
  type Paso,
} from '@/lib/mensajes-config'
import { renderParaVistaPrevia } from '@/lib/templates/render'
import { cn } from '@/lib/utils'
import {
  borrarMensaje,
  guardarDatosDeMensajes,
  guardarMensaje,
  guardarTiempos,
} from '@/server/actions/mensajes'
import type { MensajeGuardado } from '@/server/setters/mensajes'

/**
 * Un mensaje por paso y por rubro.
 *
 * La pantalla está partida en dos pasos porque son dos cosas distintas: el de
 * entrada abre conversación y el de la oferta cuenta a qué te dedicás. Dentro
 * de cada paso está el general y, opcionalmente, uno escrito para cada rubro.
 */

const EJEMPLO = {
  negocio: 'Peluquería Belén',
  rubro: 'peluquería',
  ciudad: 'Catamarca',
  nombre: 'Belén',
}

export interface TiemposDeSeguimiento {
  horasSegundoMensaje: number
  horasVencimiento: number
  diasAtrasoParaAlerta: number
  diasParaUltimoIntento: number
  diasParaRetomarConversacion: number
  diasParaRetomarInteresado: number
  diasParaUltimoReenganche: number
}

export function Editor({
  config,
  tiempos,
  mensajes,
  rubros,
}: {
  config: MensajesConfig
  tiempos: TiemposDeSeguimiento
  mensajes: MensajeGuardado[]
  rubros: Array<{ rubro: string; leads: number }>
}) {
  const [paso, setPaso] = React.useState<Paso>(1)
  const delPaso = mensajes.filter((m) => m.paso === paso && m.activo)
  const general = delPaso.find((m) => m.rubro === null) ?? null
  const porRubro = delPaso.filter((m) => m.rubro !== null)

  const usados = new Set(porRubro.map((m) => m.rubro))
  const disponibles = rubros.filter((r) => !usados.has(r.rubro))

  const reloj = useTiempos(tiempos)

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[22px]">Seguimientos</h1>
        <p className="mt-1 max-w-[720px] text-[13px] leading-relaxed text-texto-2">
          Un seguimiento no sale por orden de lista: sale por los días que pasaron y por la
          situación en la que quedó el lead. Acá se define la escalera entera — cuántos días espera
          cada situación y con qué texto vuelve. El texto lo escribís vos: si una situación no tiene
          mensaje, el setter no puede trabajar los leads que caen ahí.
        </p>
      </div>

      <Escalera mensajes={mensajes} reloj={reloj} activo={paso} onElegir={setPaso} />

      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Situaciones">
        {GRUPOS_DE_PASOS.flatMap((g) => g.pasos).map((p) => {
          const cargado = mensajes.some((m) => m.paso === p && m.rubro === null && m.activo)
          return (
            <button
              key={p}
              onClick={() => setPaso(p)}
              aria-current={paso === p ? 'page' : undefined}
              className={cn(
                'flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] border px-3 text-[13px] font-medium',
                'transition-colors duration-150',
                paso === p
                  ? 'border-acento/40 bg-acento-tenue text-acento'
                  : 'border-borde bg-superficie text-texto-2 hover:text-texto',
              )}
            >
              {PASO_META[p].label}
              {/* Un punto rojo en la que falta: sin ese mensaje, esa situación
                  no se puede trabajar. */}
              {!cargado ? (
                <span className="h-1.5 w-1.5 rounded-full bg-rojo" aria-label="sin cargar" />
              ) : null}
            </button>
          )
        })}
      </nav>

      {/* Los días de esta etapa, arriba de su texto y no en otro panel: son la
          misma decisión partida en dos mitades — cuándo vuelve y qué le llega. */}
      <Disparador paso={paso} reloj={reloj} />

      <MensajeEditable
        key={`general-${paso}-${general?.id ?? 'nuevo'}`}
        mensaje={general}
        paso={paso}
        rubro={null}
        config={config}
        rubrosDisponibles={[]}
      />

      {porRubro.map((m) => (
        <MensajeEditable
          key={m.id}
          mensaje={m}
          paso={paso}
          rubro={m.rubro}
          config={config}
          rubrosDisponibles={[]}
        />
      ))}

      {disponibles.length > 0 ? (
        <NuevoPorRubro paso={paso} config={config} rubros={disponibles} />
      ) : null}

      <DatosBase config={config} />
      <Generales reloj={reloj} />
      <Variables />
    </div>
  )
}

/* ── La escalera ──────────────────────────────────────────────────────── */

/**
 * Qué hace volver a un lead, y cuánto espera antes.
 *
 * Los seguimientos no son una secuencia numerada: son cinco situaciones, y a
 * cada una la dispara un silencio distinto. Un lead que nunca dijo nada y uno
 * que dijo "me interesa" y se calló llevan los dos días de espera, pero no el
 * mismo mensaje ni la misma cantidad de días.
 *
 * `campo` es qué número de la config lo demora. Null en la entrada, que no
 * espera nada: sale cuando el setter la toma de su cola.
 */
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

/** El botón que guarda los seis números, esté donde esté el que tocaste. */
function GuardarTiempos({ reloj }: { reloj: Reloj }) {
  return (
    <Button
      variant="primaria"
      className="mb-0.5"
      disabled={reloj.pendiente || !reloj.cambiado}
      onClick={reloj.guardar}
    >
      {reloj.pendiente ? 'Guardando…' : 'Guardar'}
    </Button>
  )
}

/**
 * Las cinco situaciones en orden, con lo que las dispara.
 *
 * Es lo primero de la pantalla a propósito: el problema de tener los días en un
 * panel y los textos en otro es que nunca se ve la escalera entera. Acá se ve,
 * y tocando una se cae en su texto.
 */
function Escalera({
  mensajes,
  reloj,
  activo,
  onElegir,
}: {
  mensajes: MensajeGuardado[]
  reloj: Reloj
  activo: Paso
  onElegir: (p: Paso) => void
}) {
  return (
    <Panel>
      <PanelHeader
        titulo="Cómo vuelve un lead"
        descripcion="Cada situación en la que puede quedar un lead, y qué la dispara."
      />
      {GRUPOS_DE_PASOS.map((grupo) => (
        <div key={grupo.titulo} className="border-t border-borde first:border-t-0">
          <div className="bg-elevada px-3 py-1.5">
            <p className="text-[12px] font-medium text-texto">{grupo.titulo}</p>
            <p className="text-[11.5px] leading-relaxed text-texto-2">{grupo.detalle}</p>
          </div>
          <ol className="divide-y divide-borde/60">
            {grupo.pasos.map((p) => {
              const cargado = mensajes.some((m) => m.paso === p && m.rubro === null && m.activo)
              const espera = DISPARO[p].espera
              return (
                <li key={p}>
                  <button
                    onClick={() => onElegir(p)}
                    aria-current={activo === p ? 'step' : undefined}
                    className={cn(
                      'flex w-full items-baseline gap-3 px-3 py-2 text-left transition-colors duration-150',
                      activo === p ? 'bg-acento-tenue' : 'hover:bg-elevada',
                    )}
                  >
                    <span className="dato w-[86px] shrink-0 text-[12px] text-acento">
                      {espera
                        ? `${reloj.valores[espera.campo]} ${espera.unidad}`
                        : 'en el acto'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[13px] font-medium text-texto">
                        {PASO_META[p].label}
                        {!cargado ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-rojo" aria-label="sin cargar" />
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-relaxed text-texto-2">
                        {DISPARO[p].situacion}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      ))}
      <p className="border-t border-borde px-3 py-2 text-[11.5px] leading-relaxed text-texto-2">
        El punto rojo es una situación sin mensaje escrito. Los leads que caen ahí le quedan
        bloqueados al setter hasta que la cargues.
      </p>
    </Panel>
  )
}

/* ── Cuándo se dispara la etapa que estás editando ────────────────────── */

function Disparador({ paso, reloj }: { paso: Paso; reloj: Reloj }) {
  const { situacion, espera } = DISPARO[paso]

  return (
    <Panel className="border-borde bg-elevada">
      <div className="px-4 py-3">
        <div className="rotulo mb-1">Cuándo le llega</div>
        <p className="text-[13px] font-medium text-texto">{situacion}</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-texto-2">{PASO_META[paso].objetivo}</p>

        {espera ? (
          <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-borde pt-3">
            <Field
              label={`Vuelve a la cola a ${espera.unidad === 'horas' ? 'las' : 'los'}`}
              className="w-[130px]"
            >
              <Input
                type="number"
                min={espera.min}
                max={espera.max}
                value={reloj.valores[espera.campo]}
                onChange={(e) => reloj.poner(espera.campo, e.target.value)}
              />
            </Field>
            <span className="pb-2 text-[13px] text-texto-2">
              {espera.unidad} {espera.desde}
            </span>
            <GuardarTiempos reloj={reloj} />
          </div>
        ) : (
          <p className="mt-3 border-t border-borde pt-3 text-[12.5px] text-texto-2">
            {paso === 1
              ? 'Este no espera nada: sale cuando el setter toma el lead de su cola.'
              : 'Este no espera nada: le aparece al setter apenas marca eso en la app, con la persona todavía del otro lado.'}
          </p>
        )}
      </div>
    </Panel>
  )
}

/* ── Lo que no es de ninguna etapa ────────────────────────────────────── */

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

        <GuardarTiempos reloj={reloj} />
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

/* ── Nombre y oferta ──────────────────────────────────────────────────── */

function DatosBase({ config }: { config: MensajesConfig }) {
  const router = useRouter()
  const [miNombre, setMiNombre] = React.useState(config.miNombre)
  const [oferta, setOferta] = React.useState(config.oferta)
  const [pendiente, iniciar] = React.useTransition()

  const cambiado = miNombre !== config.miNombre || oferta !== config.oferta

  return (
    <Panel>
      <PanelHeader
        titulo="Cómo te presentás"
        descripcion="Se usan en todos los mensajes, con {{mi_nombre}} y {{oferta}}."
      />
      <div className="flex flex-wrap items-end gap-3 px-3 py-3">
        <Field label="Tu nombre" className="min-w-[160px] flex-1">
          <Input
            value={miNombre}
            onChange={(e) => setMiNombre(e.target.value)}
            placeholder="Salvador"
          />
        </Field>
        <Field label="Qué ofrecés" className="min-w-[220px] flex-[2]">
          <Input
            value={oferta}
            onChange={(e) => setOferta(e.target.value)}
            placeholder="webs, automatizaciones y CRM"
          />
        </Field>
        <Button
          variant="primaria"
          disabled={pendiente || !cambiado}
          onClick={() =>
            iniciar(async () => {
              const r = await guardarDatosDeMensajes({ miNombre, oferta })
              if (r.ok) {
                toast.success('Guardado')
                router.refresh()
              } else toast.error(r.error ?? 'No se pudo guardar.')
            })
          }
        >
          {pendiente ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </Panel>
  )
}

/* ── Un mensaje ───────────────────────────────────────────────────────── */

function MensajeEditable({
  mensaje,
  paso,
  rubro,
  config,
}: {
  mensaje: MensajeGuardado | null
  paso: Paso
  rubro: string | null
  config: MensajesConfig
  rubrosDisponibles: string[]
}) {
  const router = useRouter()
  const [cuerpo, setCuerpo] = React.useState(mensaje?.cuerpo ?? '')
  const [variantes, setVariantes] = React.useState<string[]>(mensaje?.variantes ?? [])
  const [pendiente, iniciar] = React.useTransition()

  const cambiado =
    cuerpo !== (mensaje?.cuerpo ?? '') ||
    JSON.stringify(variantes) !== JSON.stringify(mensaje?.variantes ?? [])

  const previa = renderParaVistaPrevia(cuerpo, {
    ...EJEMPLO,
    mi_nombre: config.miNombre || null,
    oferta: config.oferta || null,
  })

  function guardar(): void {
    iniciar(async () => {
      const r = await guardarMensaje({
        id: mensaje?.id ?? null,
        paso,
        rubro,
        cuerpo,
        variantes,
        activo: true,
      })
      if (r.ok) {
        toast.success('Mensaje guardado')
        router.refresh()
      } else toast.error(r.error ?? 'No se pudo guardar.')
    })
  }

  return (
    <Panel>
      <PanelHeader
        titulo={rubro ? `Solo para ${rubro}` : 'Mensaje general'}
        descripcion={
          rubro
            ? 'Le gana al general cuando el lead es de este rubro.'
            : 'El que se usa cuando el rubro del lead no tiene uno propio.'
        }
        acciones={
          rubro && mensaje ? (
            <Button
              variant="fantasma"
              size="sm"
              disabled={pendiente}
              onClick={() =>
                iniciar(async () => {
                  const r = await borrarMensaje(mensaje.id)
                  if (r.ok) {
                    toast.success('Se quitó. Ese rubro vuelve a usar el general.')
                    router.refresh()
                  } else toast.error(r.error ?? 'No se pudo quitar.')
                })
              }
            >
              <Trash2 aria-hidden />
              Quitar
            </Button>
          ) : null
        }
      />

      <div className="space-y-3 px-3 py-3">
        <Textarea
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value)}
          rows={3}
          placeholder="Escribilo como se lo escribirías vos a un cliente."
        />

        {cuerpo.trim().length === 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[6px] border border-ambar/25 bg-ambar-tenue px-3 py-2">
            <p className="min-w-[220px] flex-1 text-[12.5px] leading-relaxed text-ambar">
              Sin este mensaje, el setter no puede trabajar los leads que caen en esta situación.
            </p>
            <Button variant="secundaria" size="sm" onClick={() => setCuerpo(PASO_META[paso].ejemplo)}>
              Partir de un ejemplo
            </Button>
          </div>
        ) : null}

        {variantes.map((v, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <Textarea
              value={v}
              onChange={(e) =>
                setVariantes((vs) => vs.map((x, j) => (j === i ? e.target.value : x)))
              }
              rows={2}
              placeholder={`Variante ${i + 2}`}
            />
            <Button
              variant="fantasma"
              size="icono"
              aria-label="Quitar variante"
              onClick={() => setVariantes((vs) => vs.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}

        {variantes.length < 4 ? (
          <Button variant="fantasma" size="sm" onClick={() => setVariantes((vs) => [...vs, ''])}>
            <Plus aria-hidden />
            Agregar variante
          </Button>
        ) : null}

        <div className="rounded-[6px] border border-borde bg-elevada px-3 py-2">
          <div className="rotulo mb-1">Así lo va a ver un lead</div>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-texto">
            {previa.texto || '—'}
          </p>
          {previa.faltantes.length > 0 ? (
            <p className="mt-1.5 text-[11.5px] text-ambar">
              Si a un lead le falta {previa.faltantes.map((v) => `{{${v}}}`).join(', ')}, el mensaje
              no se manda y el setter lo saltea.
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-borde px-3 py-2">
        <span className="text-[11.5px] text-texto-2">
          {variantes.length + 1} {variantes.length === 0 ? 'redacción' : 'redacciones'} · una por
          setter
        </span>
        <Button
          variant="primaria"
          size="sm"
          onClick={guardar}
          disabled={pendiente || !cambiado || cuerpo.trim().length < 10}
        >
          {pendiente ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </Panel>
  )
}

/* ── Alta de un mensaje por rubro ─────────────────────────────────────── */

function NuevoPorRubro({
  paso,
  config,
  rubros,
}: {
  paso: Paso
  config: MensajesConfig
  rubros: Array<{ rubro: string; leads: number }>
}) {
  const [elegido, setElegido] = React.useState<string | null>(null)

  if (elegido) {
    return (
      <MensajeEditable
        key={`nuevo-${paso}-${elegido}`}
        mensaje={null}
        paso={paso}
        rubro={elegido}
        config={config}
        rubrosDisponibles={[]}
      />
    )
  }

  return (
    <Panel>
      <PanelHeader
        titulo="Escribir uno para un rubro"
        descripcion="Los rubros que hay en tu base, con cuántos leads tiene cada uno."
      />
      <div className="flex flex-wrap gap-1.5 px-3 py-3">
        {rubros.map((r) => (
          <button
            key={r.rubro}
            onClick={() => setElegido(r.rubro)}
            className="flex h-7.5 items-center gap-1.5 rounded-[5px] border border-borde bg-elevada px-2.5 text-[12.5px] text-texto hover:border-acento"
          >
            {r.rubro}
            <span className="dato text-[11px] text-texto-2">{r.leads}</span>
          </button>
        ))}
      </div>
    </Panel>
  )
}

/* ── Ayuda de variables ───────────────────────────────────────────────── */

function Variables() {
  return (
    <Panel>
      <PanelHeader
        titulo="Variables"
        descripcion="Se reemplazan por los datos del lead. Si falta un dato, el mensaje no se manda."
      />
      <div className="divide-y divide-borde/60">
        {VARIABLES_DISPONIBLES.map((v) => (
          <div key={v.clave} className="flex flex-wrap items-baseline gap-x-3 px-3 py-1.5">
            <span className="dato w-[110px] shrink-0 text-[12px] text-acento">
              {'{{'}
              {v.clave}
              {'}}'}
            </span>
            <span className="min-w-[140px] flex-1 text-[12px] text-texto-2">{v.origen}</span>
            <Chip>{v.ejemplo}</Chip>
          </div>
        ))}
      </div>
      <p className="border-t border-borde px-3 py-2 text-[11.5px] leading-relaxed text-texto-2">
        Cuantas menos uses, menos leads se saltean. {'{{negocio}}'} lo tienen todos;{' '}
        {'{{nombre}}'} casi ninguno.
      </p>
    </Panel>
  )
}

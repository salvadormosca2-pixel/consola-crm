'use client'

import { Plus, Trash2 } from 'lucide-react'
import Link from 'next/link'
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
} from '@/server/actions/mensajes'
import type { MensajeGuardado } from '@/server/setters/mensajes'

/**
 * Qué le decimos al lead en cada situación.
 *
 * Esta pantalla es **el texto**; cuándo sale cada uno se define en Seguimientos.
 * Están separadas porque son dos trabajos distintos: los días se tocan una vez
 * y quedan, y los textos se reescriben todo el tiempo según qué contesta la
 * gente y qué rubro es.
 *
 * Dentro de cada situación está el mensaje general y, si hace falta, uno
 * escrito para cada rubro: hablarle a una peluquería como a una ferretería es
 * lo que hace que el mensaje se note copiado y pegado.
 */

const EJEMPLO = {
  negocio: 'Peluquería Belén',
  rubro: 'peluquería',
  ciudad: 'Catamarca',
  nombre: 'Belén',
}

export function Editor({
  config,
  mensajes,
  rubros,
  pasoInicial,
}: {
  config: MensajesConfig
  mensajes: MensajeGuardado[]
  rubros: Array<{ rubro: string; leads: number }>
  /** Con cuál abrir. Viene de tocar una situación en Seguimientos. */
  pasoInicial: Paso
}) {
  const [paso, setPaso] = React.useState<Paso>(pasoInicial)
  const delPaso = mensajes.filter((m) => m.paso === paso && m.activo)
  const general = delPaso.find((m) => m.rubro === null) ?? null
  const porRubro = delPaso.filter((m) => m.rubro !== null)

  const usados = new Set(porRubro.map((m) => m.rubro))
  const disponibles = rubros.filter((r) => !usados.has(r.rubro))

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[22px]">Mensajes</h1>
        <p className="mt-1 max-w-[720px] text-[13px] leading-relaxed text-texto-2">
          Todo lo que mandan los setters lo escribís vos: el sistema no inventa ni completa texto.
          Si una situación no tiene mensaje cargado, el setter no puede trabajar los leads que caen
          ahí y le quedan bloqueados con el motivo a la vista. Cuándo sale cada uno se define en{' '}
          <Link href="/seguimientos" className="text-acento hover:underline">
            Seguimientos
          </Link>
          .
        </p>
      </div>

      <DatosBase config={config} />

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

      {/* Cuándo le llega, para escribir sabiendo en qué momento se lee. Los días
          no se tocan acá: se tocan en Seguimientos, que es donde se ve la
          escalera entera y se pueden comparar entre sí. */}
      <Panel className="border-borde bg-elevada">
        <div className="px-4 py-3">
          <div className="rotulo mb-1">Cuándo le llega</div>
          <p className="text-[13px] font-medium text-texto">{PASO_META[paso].cuando}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-texto-2">
            {PASO_META[paso].objetivo}
          </p>
        </div>
      </Panel>

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

      <Variables />
    </div>
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

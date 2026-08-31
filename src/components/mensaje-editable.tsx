'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { Chip, Panel, PanelHeader } from '@/components/ui/panel'
import { PASO_META, VARIABLES_DISPONIBLES, type MensajesConfig, type Paso } from '@/lib/mensajes-config'
import { renderParaVistaPrevia } from '@/lib/templates/render'
import { borrarMensaje, guardarMensaje } from '@/server/actions/mensajes'
import type { MensajeGuardado } from '@/server/setters/mensajes'

/**
 * Escribir un texto, se escriba donde se escriba.
 *
 * Vive acá y no dentro de una pantalla porque los textos están repartidos en
 * dos: los principales se escriben en Mensajes y los de seguimiento en
 * Seguimientos, al lado de su día. Es el mismo trabajo y tiene que verse y
 * guardarse igual en las dos — si se duplicara el componente, la vista previa
 * o el aviso de "falta el mensaje" quedarían distintos en una y en otra.
 */

const EJEMPLO = {
  negocio: 'Peluquería Belén',
  rubro: 'peluquería',
  ciudad: 'Catamarca',
  nombre: 'Belén',
}

/* ── Un mensaje ───────────────────────────────────────────────────────── */

export function MensajeEditable({
  mensaje,
  paso,
  rubro,
  config,
}: {
  mensaje: MensajeGuardado | null
  paso: Paso
  rubro: string | null
  config: MensajesConfig
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

export function NuevoPorRubro({
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

/* ── Los mensajes de una situación, juntos ────────────────────────────── */

/**
 * El general, los que tengan rubro propio, y la puerta para agregar otro.
 *
 * Las dos pantallas muestran exactamente esto debajo de la situación elegida,
 * así que el armado va acá y no repetido en cada una.
 */
export function MensajesDeLaSituacion({
  paso,
  mensajes,
  config,
  rubros,
}: {
  paso: Paso
  /** Todos los guardados; acá se filtran los de este paso. */
  mensajes: MensajeGuardado[]
  config: MensajesConfig
  rubros: Array<{ rubro: string; leads: number }>
}) {
  const delPaso = mensajes.filter((m) => m.paso === paso && m.activo)
  const general = delPaso.find((m) => m.rubro === null) ?? null
  const porRubro = delPaso.filter((m) => m.rubro !== null)

  const usados = new Set(porRubro.map((m) => m.rubro))
  const disponibles = rubros.filter((r) => !usados.has(r.rubro))

  return (
    <>
      <MensajeEditable
        key={`general-${paso}-${general?.id ?? 'nuevo'}`}
        mensaje={general}
        paso={paso}
        rubro={null}
        config={config}
      />

      {porRubro.map((m) => (
        <MensajeEditable key={m.id} mensaje={m} paso={paso} rubro={m.rubro} config={config} />
      ))}

      {disponibles.length > 0 ? (
        <NuevoPorRubro paso={paso} config={config} rubros={disponibles} />
      ) : null}
    </>
  )
}

/* ── Ayuda de variables ───────────────────────────────────────────────── */

export function Variables() {
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

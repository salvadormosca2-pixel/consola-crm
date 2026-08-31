'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { MensajesDeLaSituacion, Variables } from '@/components/mensaje-editable'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { PASO_META, type MensajesConfig, type Paso } from '@/lib/mensajes-config'
import { GRUPOS_DE_MENSAJES } from '@/lib/pistas'
import { cn } from '@/lib/utils'
import { guardarDatosDeMensajes } from '@/server/actions/mensajes'
import type { MensajeGuardado } from '@/server/setters/mensajes'

/**
 * Los mensajes que no dependen de ningún día.
 *
 * La apertura —entrada y oferta, las dos en el acto— y los tres que salen
 * apenas el setter marca qué contestó el lead.
 *
 * **Los escalones de las pistas no están acá.** Esos se escriben en
 * Seguimientos, en la misma fila que su día, porque el texto depende de cuántos
 * días pasaron: a los dos le preguntás si lo vio, a los once le cerrás la
 * puerta. Escribir eso sin el día a la vista es escribir a ciegas.
 *
 * Dentro de cada uno está el mensaje general y, si hace falta, uno escrito para
 * cada rubro: hablarle a una peluquería como a una ferretería es lo que hace
 * que el mensaje se note copiado y pegado.
 */

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

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[22px]">Mensajes</h1>
        <p className="mt-1 max-w-[720px] text-[13px] leading-relaxed text-texto-2">
          Los que salen sin esperar ningún día: la entrada y la oferta, y los tres que salen en el
          acto cuando el setter marca qué contestó. Todo lo que mandan los setters lo escribís vos:
          el sistema no inventa ni completa texto. Los escalones de las pistas —silencio, tibio y
          reintento— se escriben en{' '}
          <Link href="/seguimientos" className="text-acento hover:underline">
            Seguimientos
          </Link>
          , cada uno pegado a su día.
        </p>
      </div>

      <DatosBase config={config} />

      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Situaciones">
        {GRUPOS_DE_MENSAJES.flatMap((g) => g.pasos).map((p) => {
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

      {/* Cuándo le llega, para escribir sabiendo en qué momento se lee. */}
      <Panel className="border-borde bg-elevada">
        <div className="px-4 py-3">
          <div className="rotulo mb-1">Cuándo le llega</div>
          <p className="text-[13px] font-medium text-texto">{PASO_META[paso].cuando}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-texto-2">
            {PASO_META[paso].objetivo}
          </p>
        </div>
      </Panel>

      <MensajesDeLaSituacion paso={paso} mensajes={mensajes} config={config} rubros={rubros} />

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

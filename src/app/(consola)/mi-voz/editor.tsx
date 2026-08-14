'use client'

import { Plus, X } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Field, Input, Label, Textarea } from '@/components/ui/input'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { cn } from '@/lib/utils'
import type { PerfilDeVoz } from '@/lib/voice'
import { guardarVoz } from '@/server/actions/contacts'

/**
 * Editor de la voz.
 *
 * Es a propósito corto: lo único que hace falta guardar son los arranques de
 * mensaje reales, para tenerlos de referencia al escribir una plantilla. Una
 * descripción del tono se interpreta de diez maneras; un arranque tuyo, no.
 */
export function EditorDeVoz({ inicial }: { inicial: PerfilDeVoz }) {
  const [voz, setVoz] = React.useState<PerfilDeVoz>(inicial)
  const [pendiente, iniciar] = React.useTransition()
  const [nuevo, setNuevo] = React.useState('')

  const set = <K extends keyof PerfilDeVoz>(k: K, v: PerfilDeVoz[K]) =>
    setVoz((p) => ({ ...p, [k]: v }))

  function guardar(siguiente: PerfilDeVoz = voz) {
    iniciar(async () => {
      const r = await guardarVoz(siguiente)
      if (r.ok) toast.success('Guardado')
      else toast.error(r.error ?? 'No se pudo guardar.')
    })
  }

  function agregar() {
    const limpio = nuevo.trim()
    if (!limpio) return
    const siguiente = { ...voz, ejemplos: [...voz.ejemplos, limpio] }
    setVoz(siguiente)
    setNuevo('')
    guardar(siguiente)
  }

  return (
    <div className="max-w-3xl space-y-3">
      {/* ── Los arranques ─────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          titulo="Cómo arrancás un mensaje"
          descripcion="Pegá los arranques que usás de verdad. Quedan acá para tenerlos a mano al escribir una plantilla."
        />

        <div className="space-y-2 p-3">
          {voz.ejemplos.length > 0 ? (
            <ul className="space-y-1.5">
              {voz.ejemplos.map((ej, i) => (
                <li
                  key={i}
                  className="group flex items-start gap-2 rounded-[5px] border border-borde bg-fondo px-2.5 py-2"
                >
                  <span className="dato mt-0.5 shrink-0 text-[10px] text-texto-2">{i + 1}</span>
                  <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-texto">{ej}</p>
                  <div className="flex shrink-0 gap-0.5">
                    <Button
                      variant="fantasma"
                      size="iconoSm"
                      title="Copiar"
                      aria-label={`Copiar arranque ${i + 1}`}
                      onClick={() => {
                        void navigator.clipboard.writeText(ej)
                        toast.success('Copiado')
                      }}
                    >
                      <span className="text-[10px]">⧉</span>
                    </Button>
                    <Button
                      variant="fantasma"
                      size="iconoSm"
                      className="hover:text-rojo"
                      title="Borrar"
                      aria-label={`Borrar arranque ${i + 1}`}
                      onClick={() => {
                        const siguiente = { ...voz, ejemplos: voz.ejemplos.filter((_, k) => k !== i) }
                        setVoz(siguiente)
                        guardar(siguiente)
                      }}
                    >
                      <X aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-[5px] border border-dashed border-borde px-3 py-4 text-center text-[12.5px] text-texto-2">
              Todavía no cargaste ninguno. Pegá abajo un mensaje que hayas mandado de verdad.
            </p>
          )}

          {voz.ejemplos.length < 10 ? (
            <div className="flex items-start gap-1.5 pt-1">
              <Textarea
                value={nuevo}
                rows={2}
                onChange={(e) => setNuevo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    agregar()
                  }
                }}
                placeholder="Hola Marce, ¿cómo va? Te escribo por lo del pack de reels que hicimos el año pasado…"
              />
              <Button
                variant="primaria"
                size="md"
                onClick={agregar}
                disabled={!nuevo.trim() || pendiente}
                className="mt-0.5"
              >
                <Plus aria-hidden />
                Agregar
              </Button>
            </div>
          ) : null}

          <p className="text-[11px] text-texto-2">
            Podés usar las variables{' '}
            <code className="dato text-texto">{'{{nombre}}'}</code>,{' '}
            <code className="dato text-texto">{'{{negocio}}'}</code>,{' '}
            <code className="dato text-texto">{'{{compro}}'}</code> y{' '}
            <code className="dato text-texto">{'{{rubro}}'}</code> — se reemplazan solas en cada
            mensaje.
          </p>
        </div>
      </Panel>

      {/* ── Dos datos que usan las plantillas ─────────────────────────── */}
      <Panel>
        <PanelHeader
          titulo="Dos datos que necesitan las plantillas"
          descripcion="Rellenan las variables {{mi_nombre}} y {{oferta}} cuando las usás."
        />
        <div className="grid gap-2 p-3 sm:grid-cols-2">
          <Field label="Con qué nombre firmás">
            <Input
              value={voz.miNombre}
              onChange={(e) => set('miNombre', e.target.value)}
              onBlur={() => guardar()}
              placeholder="Salva, del estudio"
            />
          </Field>
          <Field label="Qué estás ofreciendo">
            <Input
              value={voz.oferta}
              onChange={(e) => set('oferta', e.target.value)}
              onBlur={() => guardar()}
              placeholder="gestión de redes con contenido propio"
            />
          </Field>
        </div>
      </Panel>

      {/* ── Palabras a evitar ─────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          titulo="Palabras que no usás"
          descripcion="Las que delatan una plantilla. Si aparecen en un mensaje, te avisa antes de mandarlo."
        />
        <div className="p-3">
          <Prohibidas
            valores={voz.prohibidas}
            onCambio={(v) => {
              const siguiente = { ...voz, prohibidas: v }
              setVoz(siguiente)
              guardar(siguiente)
            }}
          />
        </div>
      </Panel>

      <div className="flex justify-end">
        <Button variant="primaria" onClick={() => guardar()} disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </div>
  )
}

function Prohibidas({
  valores,
  onCambio,
}: {
  valores: string[]
  onCambio: (v: string[]) => void
}) {
  const [texto, setTexto] = React.useState('')

  function agregar() {
    const limpio = texto.trim()
    if (!limpio || valores.includes(limpio) || valores.length >= 30) return
    onCambio([...valores, limpio])
    setTexto('')
  }

  return (
    <>
      <Label>Agregar una</Label>
      <div className="flex gap-1.5">
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              agregar()
            }
          }}
          placeholder="estimado, aprovecho para, no dude en…"
        />
        <Button variant="secundaria" size="md" onClick={agregar} disabled={!texto.trim()}>
          <Plus aria-hidden />
        </Button>
      </div>

      {valores.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {valores.map((v) => (
            <button
              key={v}
              onClick={() => onCambio(valores.filter((x) => x !== v))}
              title="Sacar"
              className={cn(
                'flex items-center gap-1 rounded-[4px] border border-rojo/35 bg-rojo/10 px-1.5 py-0.5',
                'text-[11px] text-rojo transition-colors duration-150 hover:bg-rojo/20',
              )}
            >
              {v}
              <X className="h-2.5 w-2.5" aria-hidden />
            </button>
          ))}
        </div>
      ) : null}
    </>
  )
}

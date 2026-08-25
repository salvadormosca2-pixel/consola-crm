'use client'

import { ChevronDown, ChevronUp, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Chip, Panel, PanelHeader } from '@/components/ui/panel'
import { CATEGORIA_META, CATEGORIAS, type Categoria } from '@/lib/referencias'
import { cn } from '@/lib/utils'
import {
  activarReferencia,
  borrarReferencia,
  guardarReferencia,
  moverReferencia,
} from '@/server/actions/referencias'
import type { Referencia } from '@/server/setters/referencias'

/**
 * Las referencias, por categoría.
 *
 * Una categoría a la vez: cargar veinte preguntas de precio y verlas mezcladas
 * con las de "sobre nosotros" no ayuda a escribirlas. El orden importa y se
 * cambia acá, porque el setter lee de arriba hacia abajo con el cliente
 * esperando: la que más preguntan va primera.
 */
export function Editor({ referencias }: { referencias: Referencia[] }) {
  const [categoria, setCategoria] = React.useState<Categoria>('nosotros')
  const [creando, setCreando] = React.useState(false)

  const deLaCategoria = referencias.filter((r) => r.categoria === categoria)
  const activas = referencias.filter((r) => r.activa).length

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[22px]">Referencias</h1>
        <p className="mt-1 max-w-[720px] text-[13px] leading-relaxed text-texto-2">
          Lo que el setter lee cuando el cliente pregunta algo que no estaba en el guion. Las
          escribís vos, igual que los mensajes: el sistema no sugiere ni completa nada. Ellos
          buscan, leen y copian la respuesta tal cual.
        </p>
        <p className="mt-2 text-[12.5px] text-texto-2">
          <span className="dato text-texto">{activas}</span> publicadas de{' '}
          <span className="dato text-texto">{referencias.length}</span> cargadas.
        </p>
      </div>

      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Categorías">
        {CATEGORIAS.map((c) => {
          const n = referencias.filter((r) => r.categoria === c && r.activa).length
          return (
            <button
              key={c}
              onClick={() => {
                setCategoria(c)
                setCreando(false)
              }}
              aria-current={categoria === c ? 'page' : undefined}
              className={cn(
                'flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] border px-3 text-[13px] font-medium',
                'transition-colors duration-150',
                categoria === c
                  ? 'border-acento/40 bg-acento-tenue text-acento'
                  : 'border-borde bg-superficie text-texto-2 hover:text-texto',
              )}
            >
              {CATEGORIA_META[c].label}
              <span className="dato text-[12px] opacity-70">{n}</span>
            </button>
          )
        })}
      </nav>

      <Panel className="border-borde bg-elevada">
        <div className="px-4 py-3">
          <p className="text-[12.5px] leading-relaxed text-texto-2">
            {CATEGORIA_META[categoria].cuando}
          </p>
        </div>
      </Panel>

      {deLaCategoria.map((r, i) => (
        <Ficha
          key={r.id}
          referencia={r}
          primera={i === 0}
          ultima={i === deLaCategoria.length - 1}
        />
      ))}

      {creando ? (
        <Ficha
          key={`nueva-${categoria}`}
          categoria={categoria}
          onCerrar={() => setCreando(false)}
        />
      ) : (
        <Button variant="primaria" size="lg" onClick={() => setCreando(true)}>
          <Plus aria-hidden />
          Agregar una pregunta
        </Button>
      )}

      {deLaCategoria.length === 0 && !creando ? (
        <Panel className="px-4 py-8 text-center">
          <p className="text-[13px] leading-relaxed text-texto-2">
            Todavía no cargaste ninguna en {CATEGORIA_META[categoria].label.toLowerCase()}.
          </p>
        </Panel>
      ) : null}
    </div>
  )
}

/* ── Una pregunta con su respuesta ────────────────────────────────────── */

function Ficha({
  referencia,
  categoria,
  primera,
  ultima,
  onCerrar,
}: {
  referencia?: Referencia
  categoria?: Categoria
  primera?: boolean
  ultima?: boolean
  onCerrar?: () => void
}) {
  const router = useRouter()
  const esNueva = referencia === undefined

  const [abierta, setAbierta] = React.useState(esNueva)
  const [pregunta, setPregunta] = React.useState(referencia?.pregunta ?? '')
  const [respuesta, setRespuesta] = React.useState(referencia?.respuesta ?? '')
  const [nota, setNota] = React.useState(referencia?.nota ?? '')
  const [pendiente, iniciar] = React.useTransition()

  const sinCambios =
    !esNueva &&
    pregunta === referencia.pregunta &&
    respuesta === referencia.respuesta &&
    nota === (referencia.nota ?? '')

  function guardar(): void {
    iniciar(async () => {
      const r = await guardarReferencia({
        id: referencia?.id,
        categoria: referencia?.categoria ?? categoria,
        pregunta,
        respuesta,
        nota,
        activa: referencia?.activa ?? true,
      })
      if (r.ok) {
        toast.success(esNueva ? 'Referencia agregada' : 'Guardada')
        if (esNueva) {
          setPregunta('')
          setRespuesta('')
          setNota('')
          onCerrar?.()
        }
        router.refresh()
      } else {
        toast.error(r.error ?? 'No se pudo guardar.')
      }
    })
  }

  function correr(accion: Promise<{ ok: boolean; error: string | null }>, exito: string): void {
    iniciar(async () => {
      const r = await accion
      if (r.ok) {
        toast.success(exito)
        router.refresh()
      } else {
        toast.error(r.error ?? 'No se pudo.')
      }
    })
  }

  return (
    <Panel className={cn(referencia && !referencia.activa && 'opacity-70')}>
      {referencia ? (
        <PanelHeader
          titulo={
            <button
              onClick={() => setAbierta((v) => !v)}
              className="text-left text-[14px] font-medium text-texto hover:text-acento"
            >
              {referencia.pregunta}
            </button>
          }
          descripcion={!abierta ? recortar(referencia.respuesta) : undefined}
          acciones={
            <>
              {!referencia.activa ? <Chip>Sin publicar</Chip> : null}
              <Button
                variant="fantasma"
                size="icono"
                onClick={() => correr(moverReferencia(referencia.id, 'arriba'), 'Movida')}
                disabled={pendiente || primera}
                aria-label="Subir"
                title="Subir: el setter lee de arriba hacia abajo"
              >
                <ChevronUp aria-hidden />
              </Button>
              <Button
                variant="fantasma"
                size="icono"
                onClick={() => correr(moverReferencia(referencia.id, 'abajo'), 'Movida')}
                disabled={pendiente || ultima}
                aria-label="Bajar"
              >
                <ChevronDown aria-hidden />
              </Button>
              <Button
                variant="fantasma"
                size="icono"
                onClick={() =>
                  correr(
                    activarReferencia(referencia.id, !referencia.activa),
                    referencia.activa ? 'Sacada de la vista del equipo' : 'Publicada',
                  )
                }
                disabled={pendiente}
                aria-label={referencia.activa ? 'Despublicar' : 'Publicar'}
                title={
                  referencia.activa
                    ? 'Sacarla de la vista del equipo sin borrarla'
                    : 'Mostrarla al equipo'
                }
              >
                {referencia.activa ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
              </Button>
            </>
          }
        />
      ) : (
        <PanelHeader
          titulo="Nueva pregunta"
          descripcion={`Se agrega en ${CATEGORIA_META[categoria!].label.toLowerCase()}.`}
        />
      )}

      {abierta ? (
        <div className="space-y-3 px-4 py-3">
          <Field
            label="La pregunta"
            hint="Como la hace el cliente, no como la escribirías vos. El setter la busca así."
          >
            <Input
              value={pregunta}
              onChange={(e) => setPregunta(e.target.value)}
              placeholder="¿Cuánto sale?"
              maxLength={200}
            />
          </Field>

          <Field
            label="La respuesta"
            hint="Tal cual la mandaría vos. Esto es lo que el setter copia y pega en el chat."
          >
            <Textarea
              value={respuesta}
              onChange={(e) => setRespuesta(e.target.value)}
              rows={4}
              maxLength={2000}
            />
          </Field>

          <Field
            label="Aclaración para el setter (opcional)"
            hint="Esto no se copia al chat: es para él. Cuándo usarla, qué no prometer."
          >
            <Input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Solo si ya preguntó el precio."
              maxLength={300}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primaria"
              onClick={guardar}
              disabled={pendiente || sinCambios || !pregunta.trim() || !respuesta.trim()}
            >
              {pendiente ? 'Guardando…' : esNueva ? 'Agregar' : 'Guardar'}
            </Button>

            {esNueva ? (
              <Button variant="fantasma" onClick={onCerrar} disabled={pendiente}>
                Cancelar
              </Button>
            ) : (
              <Button
                variant="destructiva"
                onClick={() => correr(borrarReferencia(referencia.id), 'Borrada')}
                disabled={pendiente}
              >
                <Trash2 aria-hidden />
                Borrar
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </Panel>
  )
}

function recortar(texto: string): string {
  const plano = texto.replace(/\s+/g, ' ').trim()
  return plano.length > 120 ? `${plano.slice(0, 120)}…` : plano
}

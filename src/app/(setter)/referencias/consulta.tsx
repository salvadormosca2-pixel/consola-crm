'use client'

import { Copy, Search, X } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Input } from '@/components/ui/input'
import { Panel } from '@/components/ui/panel'
import { CATEGORIA_META } from '@/lib/referencias'
import { copiarAlPortapapeles } from '@/lib/copiar'
import { cn } from '@/lib/utils'
import type { GrupoDeReferencias, Referencia } from '@/server/setters/referencias'

/**
 * La chuleta del setter.
 *
 * Le preguntaron algo, tiene el chat abierto y el cliente esperando. Escribe
 * dos letras, toca la pregunta, toca "Copiar" y vuelve a Instagram a pegar.
 * Eso es todo lo que hace esta pantalla.
 *
 * Las respuestas son las que escribió el admin, palabra por palabra. Acá no se
 * arma ni se completa nada: si algo no está cargado, no está, y el setter sabe
 * que tiene que preguntar en vez de inventar.
 */
export function Consulta({ grupos }: { grupos: GrupoDeReferencias[] }) {
  const [texto, setTexto] = React.useState('')
  const [abierta, setAbierta] = React.useState<string | null>(null)

  const termino = texto.trim().toLowerCase()

  const filtrados = React.useMemo(() => {
    if (termino.length === 0) return grupos
    return grupos
      .map((g) => ({
        categoria: g.categoria,
        referencias: g.referencias.filter(
          (r) =>
            r.pregunta.toLowerCase().includes(termino) ||
            r.respuesta.toLowerCase().includes(termino),
        ),
      }))
      .filter((g) => g.referencias.length > 0)
  }, [grupos, termino])

  const total = filtrados.reduce((n, g) => n + g.referencias.length, 0)

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-texto-2"
          aria-hidden
        />
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar: precio, garantía, cuánto tarda…"
          aria-label="Buscar una respuesta"
          className="h-11 pl-8 pr-9 text-[16px]"
        />
        {texto ? (
          <button
            onClick={() => setTexto('')}
            aria-label="Limpiar"
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-texto-2"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {grupos.length === 0 ? (
        <Panel className="px-4 py-10 text-center">
          <p className="text-[13.5px] leading-relaxed text-texto-2">
            Todavía no hay referencias cargadas. Si te preguntan algo que no sabés contestar,
            preguntale al administrador antes de responder.
          </p>
        </Panel>
      ) : total === 0 ? (
        <Panel className="px-4 py-10 text-center">
          <p className="text-[13.5px] leading-relaxed text-texto-2">
            No hay ninguna respuesta que hable de &ldquo;{texto.trim()}&rdquo;. Preguntale al
            administrador antes de contestar por tu cuenta.
          </p>
        </Panel>
      ) : (
        filtrados.map((g) => (
          <section key={g.categoria} className="space-y-2">
            <h2 className="px-0.5 text-[12px] font-medium uppercase tracking-[0.04em] text-texto-2">
              {CATEGORIA_META[g.categoria].label}
            </h2>
            {g.referencias.map((r) => (
              <Tarjeta
                key={r.id}
                referencia={r}
                abierta={abierta === r.id}
                onAlternar={() => setAbierta((a) => (a === r.id ? null : r.id))}
              />
            ))}
          </section>
        ))
      )}
    </div>
  )
}

function Tarjeta({
  referencia,
  abierta,
  onAlternar,
}: {
  referencia: Referencia
  abierta: boolean
  onAlternar: () => void
}) {
  function copiar(): void {
    void copiarAlPortapapeles(referencia.respuesta).then((ok) => {
      if (ok) toast.success('Respuesta copiada — pegá en el chat')
      else toast.error('No se pudo copiar. Mantené presionado el texto y copialo a mano.')
    })
  }

  return (
    <Panel>
      <button
        onClick={onAlternar}
        aria-expanded={abierta}
        className="flex w-full items-center gap-2 px-3 py-3 text-left"
      >
        <span className="min-w-0 flex-1 text-[14.5px] leading-snug text-texto">
          {referencia.pregunta}
        </span>
        <span
          className={cn(
            'shrink-0 text-[11px] text-texto-2 transition-transform duration-150',
            abierta && 'rotate-180',
          )}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {abierta ? (
        <div className="border-t border-borde px-3 py-3">
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-texto">
            {referencia.respuesta}
          </p>

          {/* La aclaración es para él y nunca se copia: por eso va aparte y
              con otro fondo, para que no se confunda con la respuesta. */}
          {referencia.nota ? (
            <p className="mt-2 rounded-[5px] border border-borde bg-elevada px-2.5 py-2 text-[12.5px] leading-relaxed text-texto-2">
              {referencia.nota}
            </p>
          ) : null}

          <button
            onClick={copiar}
            className="mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-[6px] bg-acento text-[13.5px] font-medium text-white"
          >
            <Copy className="h-4 w-4" aria-hidden />
            Copiar respuesta
          </button>
        </div>
      ) : null}
    </Panel>
  )
}

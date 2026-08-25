'use client'

import { Search, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { Input } from '@/components/ui/input'
import { Chip, Panel, PanelHeader } from '@/components/ui/panel'
import { GRUPOS, GRUPO_META, metaDe, type GrupoDeActividad } from '@/lib/actividad'
import { formatCorto, haceCuanto } from '@/lib/tz'
import { cn } from '@/lib/utils'
import type { FilaDeActividad, ResumenDeActividad } from '@/server/setters/actividad'

/**
 * El registro, en orden y filtrable por persona.
 *
 * Se lee de arriba hacia abajo como una conversación: quién, qué, sobre quién
 * y cuándo. El detalle de cada evento —el cupo que quedaba, la cuenta que usó,
 * el motivo por el que volvió al pozo— va en gris al final de la línea, para
 * que se pueda leer la columna de la izquierda sin tropezar.
 */
export function Registro({
  resumen,
  filas,
  filtros,
}: {
  resumen: ResumenDeActividad
  filas: FilaDeActividad[]
  filtros: { grupo: GrupoDeActividad | null; quien: string | null; busqueda: string }
}) {
  const router = useRouter()
  const [texto, setTexto] = React.useState(filtros.busqueda)

  const irA = React.useCallback(
    (cambios: { grupo?: GrupoDeActividad | null; quien?: string | null; q?: string }) => {
      const params = new URLSearchParams()
      const grupo = cambios.grupo !== undefined ? cambios.grupo : filtros.grupo
      const quien = cambios.quien !== undefined ? cambios.quien : filtros.quien
      const q = cambios.q !== undefined ? cambios.q : texto
      if (grupo) params.set('grupo', grupo)
      if (quien) params.set('quien', quien)
      if (q.trim()) params.set('q', q.trim())
      router.push(`/actividad${params.size > 0 ? `?${params}` : ''}` as never, { scroll: false })
    },
    [router, filtros.grupo, filtros.quien, texto],
  )

  React.useEffect(() => {
    if (texto === filtros.busqueda) return
    const id = setTimeout(() => irA({ q: texto }), 350)
    return () => clearTimeout(id)
  }, [texto, filtros.busqueda, irA])

  const persona = resumen.porPersona.find((p) => p.userId === filtros.quien)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px]">Actividad</h1>
          <p className="mt-0.5 max-w-[720px] text-[12.5px] leading-relaxed text-texto-2">
            Todo lo que hace el equipo queda registrado con su autor y su hora, en la misma
            transacción que lo ejecuta. Nada se borra: deshacer un envío agrega la línea de que se
            deshizo.
            {resumen.desde ? ` Hay registro desde el ${formatCorto(resumen.desde)}.` : ''}
          </p>
        </div>
        <span className="dato text-[13px] text-texto">
          {resumen.hoy}
          <span className="text-texto-2"> acciones hoy</span>
        </span>
      </div>

      {/* Quién trabajó hoy. Tocar un nombre filtra el registro entero. */}
      {resumen.porPersona.length > 0 ? (
        <Panel>
          <PanelHeader titulo="Hoy" descripcion="Tocá un nombre para ver solo lo suyo." />
          <div className="flex flex-wrap gap-1.5 px-4 py-3">
            {resumen.porPersona.map((p) => {
              const activa = filtros.quien === p.userId
              return (
                <button
                  key={p.userId}
                  onClick={() => irA({ quien: activa ? null : p.userId })}
                  aria-pressed={activa}
                  className={cn(
                    'flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-[12.5px]',
                    activa
                      ? 'border-acento bg-acento-tenue text-acento'
                      : 'border-borde bg-elevada text-texto-2 hover:text-texto',
                  )}
                >
                  {p.nombre}
                  <span className="dato text-[13px] font-semibold">{p.acciones}</span>
                </button>
              )
            })}
          </div>
        </Panel>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-texto-2"
            aria-hidden
          />
          <Input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar por negocio o usuario de Instagram"
            aria-label="Buscar en la actividad"
            className="h-9 pl-8 pr-8"
          />
          {texto ? (
            <button
              onClick={() => setTexto('')}
              aria-label="Limpiar"
              className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-texto-2"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1">
          <Solapa
            activa={filtros.grupo === null}
            onClick={() => irA({ grupo: null })}
            texto="Todo"
          />
          {GRUPOS.map((g) => (
            <Solapa
              key={g}
              activa={filtros.grupo === g}
              onClick={() => irA({ grupo: g })}
              texto={GRUPO_META[g].label}
              n={resumen.porGrupo[g]}
              title={GRUPO_META[g].detalle}
            />
          ))}
        </div>
      </div>

      <Panel>
        <PanelHeader
          titulo={
            persona
              ? `Lo que hizo ${persona.nombre}`
              : filtros.grupo
                ? GRUPO_META[filtros.grupo].label
                : 'Todo, lo último arriba'
          }
          descripcion={filas.length >= 300 ? 'Se muestran las últimas 300.' : undefined}
          acciones={
            filtros.grupo || filtros.quien || filtros.busqueda ? (
              <button
                onClick={() => {
                  setTexto('')
                  irA({ grupo: null, quien: null, q: '' })
                }}
                className="flex items-center gap-1 text-[12px] text-texto-2 hover:text-texto"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                Quitar filtros
              </button>
            ) : undefined
          }
        />

        {filas.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-texto-2">
            No hay nada registrado con esos filtros.
          </p>
        ) : (
          <div className="divide-y divide-borde">
            {filas.map((f) => {
              const meta = metaDe(f.tipo)
              return (
                <div
                  key={f.id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-2 text-[12.5px]"
                >
                  <span className="min-w-[110px] font-medium text-texto">
                    {f.quien ?? <span className="text-texto-3">el sistema</span>}
                  </span>

                  <Chip tono={meta.tono}>{meta.label}</Chip>

                  {f.negocio ? (
                    <span className="text-texto-2">
                      {f.negocio}
                      {f.igUsername ? <span className="dato text-texto-3"> @{f.igUsername}</span> : null}
                    </span>
                  ) : null}

                  <Detalle tipo={f.tipo} datos={f.datos} />

                  <span
                    className="ml-auto shrink-0 text-[11.5px] text-texto-3"
                    title={f.cuando.toLocaleString('es-AR')}
                  >
                    {haceCuanto(f.cuando)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Panel>
    </div>
  )
}

function Solapa({
  activa,
  onClick,
  texto,
  n,
  title,
}: {
  activa: boolean
  onClick: () => void
  texto: string
  n?: number
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      aria-current={activa ? 'page' : undefined}
      title={title}
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-[8px] border px-3 text-[12.5px] font-medium',
        activa
          ? 'border-acento bg-acento-tenue text-acento'
          : 'border-borde bg-superficie text-texto-2 hover:text-texto',
      )}
    >
      {texto}
      {n !== undefined ? <span className="dato text-[11.5px] opacity-70">{n}</span> : null}
    </button>
  )
}

/**
 * Lo que guardó el evento, en una línea.
 *
 * Cada tipo guarda cosas distintas, así que se elige a mano lo que vale la
 * pena mostrar. Lo que no está contemplado no se dibuja: una línea con el JSON
 * crudo pesa más de lo que aporta.
 */
function Detalle({ tipo, datos }: { tipo: string; datos: Record<string, unknown> }) {
  const partes: string[] = []
  const texto = (k: string): string | null => {
    const v = datos[k]
    return typeof v === 'string' && v.length > 0 ? v : null
  }
  const numero = (k: string): number | null => {
    const v = datos[k]
    return typeof v === 'number' ? v : null
  }

  if (tipo === 'lead_contactado' || tipo === 'lead_segundo_enviado') {
    const cuenta = texto('cuenta')
    const usado = numero('usadoHoy')
    const cupo = numero('cupo')
    if (cuenta) partes.push(`desde @${cuenta}`)
    if (usado !== null && cupo !== null) partes.push(`${usado}/${cupo} del día`)
  }

  if (tipo === 'lead_respondio') {
    const a = texto('respondioA')
    if (a) partes.push(a === 'segundo' ? 'a la oferta' : 'al 1er mensaje')
    const interes = texto('interes')
    if (interes) partes.push(interes === 'interesa' ? 'le interesa' : 'no le interesa')
    const nota = texto('nota')
    if (nota) partes.push(`"${nota}"`)
    if (datos.porElAdmin === true) partes.push('marcado por el admin')
  }

  if (tipo === 'leads_asignados') {
    const n = numero('cantidad') ?? numero('total')
    if (n !== null) partes.push(`${n} leads`)
  }

  if (tipo === 'lead_devuelto' || tipo === 'lead_reasignado') {
    const motivo = texto('motivo') ?? texto('devueltoMotivo')
    if (motivo) partes.push(motivo)
  }

  if (tipo === 'envio_setter_deshecho') {
    const paso = numero('paso')
    if (paso !== null) partes.push(paso === 1 ? 'el 1er mensaje' : `el paso ${paso}`)
  }

  if (partes.length === 0) return null
  return <span className="text-texto-3">{partes.join(' · ')}</span>
}

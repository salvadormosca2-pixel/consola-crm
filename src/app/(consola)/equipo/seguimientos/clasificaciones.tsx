'use client'

import { ExternalLink, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { Chip, Panel, PanelHeader } from '@/components/ui/panel'
import { PASO_META } from '@/lib/mensajes-config'
import {
  CLASIFICACIONES,
  CLASIFICACION_META,
  type Clasificacion,
} from '@/lib/seguimientos-vistas'
import { formatCorto, haceCuanto } from '@/lib/tz'
import { cn } from '@/lib/utils'
import type { Conteos, LeadClasificado } from '@/server/setters/seguimientos'

/**
 * Los siete números, y la lista que se abre al tocar uno.
 *
 * Es el mismo bloque en la pantalla general y en la ficha de cada setter, con
 * los mismos rótulos: así el 30 de Abril y el 90 del equipo se leen igual y se
 * pueden comparar sin traducir nada.
 *
 * La lista aparece **debajo del número que la abrió**, no al final de la
 * página: se toca un número y se ve de qué está hecho, ahí mismo.
 */
export function Clasificaciones({
  conteos,
  abierta,
  leads,
  /** Base de la URL, para que la ficha de un setter abra sus propias listas. */
  base,
  /** En la ficha se lee "contactó a 30"; en la general, "Contactados 30". */
  enSetter = false,
}: {
  conteos: Conteos
  abierta: Clasificacion | null
  leads: LeadClasificado[]
  base: string
  enSetter?: boolean
}) {
  const router = useRouter()

  function alternar(c: Clasificacion): void {
    const destino = c === abierta ? base : `${base}?ver=${c}`
    router.push(destino as never, { scroll: false })
  }

  const trabajo = CLASIFICACIONES.filter((c) => CLASIFICACION_META[c].grupo === 'trabajo')
  const resultado = CLASIFICACIONES.filter((c) => CLASIFICACION_META[c].grupo === 'resultado')

  return (
    <div className="space-y-3">
      <Grupo
        titulo="El trabajo"
        clasificaciones={trabajo}
        conteos={conteos}
        abierta={abierta}
        onTocar={alternar}
        enSetter={enSetter}
      />

      {/* La lista va pegada al grupo que la abrió. */}
      {abierta && CLASIFICACION_META[abierta].grupo === 'trabajo' ? (
        <ListaDeLeads
          clasificacion={abierta}
          leads={leads}
          onCerrar={() => router.push(base as never, { scroll: false })}
        />
      ) : null}

      <Grupo
        titulo="El resultado"
        clasificaciones={resultado}
        conteos={conteos}
        abierta={abierta}
        onTocar={alternar}
        enSetter={enSetter}
      />

      {abierta && CLASIFICACION_META[abierta].grupo === 'resultado' ? (
        <ListaDeLeads
          clasificacion={abierta}
          leads={leads}
          onCerrar={() => router.push(base as never, { scroll: false })}
        />
      ) : null}
    </div>
  )
}

function Grupo({
  titulo,
  clasificaciones,
  conteos,
  abierta,
  onTocar,
  enSetter,
}: {
  titulo: string
  clasificaciones: readonly Clasificacion[]
  conteos: Conteos
  abierta: Clasificacion | null
  onTocar: (c: Clasificacion) => void
  enSetter: boolean
}) {
  return (
    <div>
      <h2 className="mb-1.5 px-0.5 text-[12px] font-medium uppercase tracking-[0.04em] text-texto-2">
        {titulo}
      </h2>
      <div
        className={cn(
          'grid gap-2',
          clasificaciones.length > 2 ? 'sm:grid-cols-3 lg:grid-cols-5' : 'sm:grid-cols-2',
        )}
      >
        {clasificaciones.map((c) => {
          const meta = CLASIFICACION_META[c]
          const n = conteos[c]
          const activa = abierta === c
          const color =
            n === 0
              ? 'text-texto-2'
              : meta.tono === 'malo'
                ? 'text-rojo'
                : meta.tono === 'bueno'
                  ? 'text-verde'
                  : 'text-texto'

          return (
            <button
              key={c}
              onClick={() => onTocar(c)}
              aria-expanded={activa}
              title={meta.detalle}
              className={cn(
                'rounded-[10px] border bg-superficie px-3 py-2.5 text-left transition-colors duration-150',
                activa ? 'border-acento ring-2 ring-acento/15' : 'border-borde hover:border-borde-fuerte',
              )}
            >
              <div className={cn('dato text-[24px] font-semibold leading-none', color)}>{n}</div>
              <div className="mt-1 text-[12px] leading-snug text-texto-2">
                {enSetter ? meta.enSetter : meta.label}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── La lista que se abre ─────────────────────────────────────────────── */

function ListaDeLeads({
  clasificacion,
  leads,
  onCerrar,
}: {
  clasificacion: Clasificacion
  leads: LeadClasificado[]
  onCerrar: () => void
}) {
  const meta = CLASIFICACION_META[clasificacion]

  return (
    <Panel className="border-acento/35">
      <PanelHeader
        titulo={meta.label}
        descripcion={meta.detalle}
        acciones={
          <button
            onClick={onCerrar}
            aria-label="Cerrar la lista"
            className="flex h-7 w-7 items-center justify-center rounded-[5px] text-texto-2 hover:bg-elevada hover:text-texto"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        }
      />

      {leads.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-texto-2">{meta.vacio}</p>
      ) : (
        <div className="divide-y divide-borde">
          {leads.map((l) => (
            <div
              key={l.assignmentId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2"
            >
              <div className="min-w-[170px] flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13.5px] text-texto">{l.negocio}</span>
                  {l.interes === 'interesa' ? (
                    <Chip tono="positivo">le interesa</Chip>
                  ) : l.interes === 'no_interesa' ? (
                    <Chip tono="negativo">no le interesa</Chip>
                  ) : l.respondioA === 'primero' ? (
                    <Chip tono="activo">le falta la oferta</Chip>
                  ) : null}
                </div>
                <p className="dato mt-0.5 text-[11.5px] text-texto-2">
                  @{l.igUsername}
                  {l.rubro ? ` · ${l.rubro}` : ''}
                </p>
              </div>

              {/* Qué mensaje le toca. Solo cuando le toca alguno. */}
              {l.paso ? <Chip>{PASO_META[l.paso].label}</Chip> : null}

              <span className="min-w-[100px] text-[12px] text-texto-2">{l.setterNombre}</span>

              <span className="min-w-[130px] text-right text-[12px] text-texto-2">
                <Cuando clasificacion={clasificacion} lead={l} />
              </span>

              <a
                href={`https://ig.me/m/${l.igUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Abrir el chat con ${l.negocio}`}
                className="flex h-7 w-7 items-center justify-center rounded-[5px] text-texto-2 hover:bg-elevada hover:text-texto"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </div>
          ))}
        </div>
      )}

      {leads.length >= 500 ? (
        <p className="border-t border-borde px-4 py-2 text-[11.5px] text-texto-2">
          Se muestran los primeros 500.
        </p>
      ) : null}
    </Panel>
  )
}

/** El dato de tiempo que importa cambia según qué se esté mirando. */
function Cuando({
  clasificacion,
  lead,
}: {
  clasificacion: Clasificacion
  lead: LeadClasificado
}) {
  if (clasificacion === 'por_contactar') {
    return (
      <span className={lead.horasParaVencer <= 12 ? 'text-ambar' : undefined}>
        {lead.horasParaVencer === 0
          ? 'vence en menos de 1 h'
          : `vence en ${lead.horasParaVencer} h`}
      </span>
    )
  }

  if (clasificacion === 'contestaron' || clasificacion === 'listos') {
    return <>contestó {lead.respondidoAt ? haceCuanto(lead.respondidoAt) : 'hace rato'}</>
  }

  if (clasificacion === 'contactados' || clasificacion === 'seguimiento_hecho') {
    return <>contactado {lead.contactadoAt ? haceCuanto(lead.contactadoAt) : 'hace rato'}</>
  }

  if (lead.diasAtraso === 0) return <span className="text-ambar">le toca hoy</span>
  return (
    <span className="text-rojo">
      {lead.diasAtraso} {lead.diasAtraso === 1 ? 'día' : 'días'}
      {lead.programadoAt ? ` · ${formatCorto(lead.programadoAt)}` : ''}
    </span>
  )
}

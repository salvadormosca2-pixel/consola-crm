'use client'

import { Download, Inbox, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Chip, Panel, PanelHeader } from '@/components/ui/panel'
import { Input } from '@/components/ui/input'
import { INTERES_META, LEAD_ESTADO_META, type UserStatus } from '@/db/enums'
import { formatCorto, haceCuanto } from '@/lib/tz'
import { VISTA_META, VISTAS, type Vista } from '@/lib/setters-vistas'
import { cn } from '@/lib/utils'
import { devolverAlPozo, reasignar, recuperarLeads, tomarLead } from '@/server/actions/equipo'
import type { FilaVista } from '@/server/setters/panel'

/**
 * Una tabla por vista, con las columnas que esa vista necesita y no más.
 *
 * "Respondieron" es la más importante y por eso está primera: son los que un
 * setter marcó y todavía no atendí, ordenados por el que hace más que espera.
 * Es mi cola de trabajo.
 */
export function VistaDeLeads({
  vista,
  filas,
  setters,
  filtros,
}: {
  vista: Vista
  filas: FilaVista[]
  setters: Array<{ id: string; nombre: string; estado: UserStatus }>
  filtros: { setterId: string; desde: string; hasta: string }
}) {
  const router = useRouter()
  const [pendiente, iniciar] = React.useTransition()
  const [elegidos, setElegidos] = React.useState<Set<string>>(new Set())

  const recuperable = vista === 'sin_respuesta'

  // Al cambiar de vista o de filtro, la selección deja de tener sentido.
  React.useEffect(() => setElegidos(new Set()), [vista, filas])

  function alternar(id: string): void {
    setElegidos((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function navegar(cambios: Partial<{ ver: string; setter: string; desde: string; hasta: string }>): void {
    const params = new URLSearchParams()
    const actual = { ver: vista, setter: filtros.setterId, desde: filtros.desde, hasta: filtros.hasta, ...cambios }
    if (actual.ver !== 'respondieron') params.set('ver', actual.ver)
    if (actual.setter) params.set('setter', actual.setter)
    if (actual.desde) params.set('desde', actual.desde)
    if (actual.hasta) params.set('hasta', actual.hasta)
    // Las rutas tipadas no aceptan una plantilla con parámetros variables.
    router.replace(`/equipo/leads${params.size > 0 ? `?${params}` : ''}` as never)
  }

  function exportar(): void {
    const cabecera = [
      'negocio',
      'instagram',
      'rubro',
      'ciudad',
      'setter',
      'estado',
      'asignado',
      'contactado',
      'respondio',
      'nota',
    ]
    const lineas = filas.map((f) =>
      [
        f.businessName,
        f.igUsername ?? '',
        f.niche ?? '',
        f.city ?? '',
        f.setterNombre ?? '',
        LEAD_ESTADO_META[f.estado].label,
        formatCorto(f.asignadoAt),
        formatCorto(f.contactadoAt),
        formatCorto(f.respondidoAt),
        f.nota ?? f.devueltoMotivo ?? '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    )

    const csv = [cabecera.join(','), ...lineas].join('\n')
    // Con BOM, para que Excel abra los acentos bien sin preguntar nada.
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${vista}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function correr(fn: () => Promise<{ ok: boolean; error: string | null }>, exito: string): void {
    iniciar(async () => {
      const r = await fn()
      if (r.ok) {
        toast.success(exito)
        router.refresh()
      } else {
        toast.error(r.error ?? 'No se pudo.')
      }
    })
  }

  return (
    <div className="space-y-3">
      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Vistas">
        {VISTAS.map((v) => (
          <button
            key={v}
            onClick={() => navegar({ ver: v })}
            aria-current={v === vista ? 'page' : undefined}
            className={cn(
              'h-7.5 shrink-0 rounded-[5px] border px-3 text-[12.5px] font-medium',
              v === vista
                ? 'border-acento/40 bg-acento-tenue text-acento'
                : 'border-borde bg-elevada text-texto-2 hover:text-texto',
            )}
          >
            {VISTA_META[v].label}
          </button>
        ))}
      </nav>

      <Panel>
        <PanelHeader
          titulo={VISTA_META[vista].label}
          descripcion={VISTA_META[vista].explicacion}
          acciones={
            <Button variant="secundaria" size="sm" onClick={exportar} disabled={filas.length === 0}>
              <Download aria-hidden />
              Exportar
            </Button>
          }
        />

        <div className="flex flex-wrap items-end gap-2 border-b border-borde px-3 py-2">
          <label className="text-[11px] text-texto-2">
            Setter
            <select
              value={filtros.setterId}
              onChange={(e) => navegar({ setter: e.target.value })}
              className="ml-1.5 h-7.5 rounded-[4px] border border-borde bg-fondo px-1.5 text-[12.5px] text-texto"
            >
              <option value="">Todos</option>
              {setters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[11px] text-texto-2">
            Desde
            <Input
              type="date"
              value={filtros.desde}
              onChange={(e) => navegar({ desde: e.target.value })}
              className="ml-1.5 inline-block w-[140px]"
            />
          </label>
          <label className="text-[11px] text-texto-2">
            Hasta
            <Input
              type="date"
              value={filtros.hasta}
              onChange={(e) => navegar({ hasta: e.target.value })}
              className="ml-1.5 inline-block w-[140px]"
            />
          </label>

          <span className="dato ml-auto text-[12px] text-texto-2">{filas.length} leads</span>
        </div>

        {recuperable && filas.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-borde bg-elevada px-4 py-2">
            <Button
              variant="secundaria"
              size="sm"
              onClick={() =>
                setElegidos((s) =>
                  s.size === filas.length ? new Set() : new Set(filas.map((f) => f.assignmentId)),
                )
              }
            >
              {elegidos.size === filas.length ? 'Ninguno' : 'Elegir todos'}
            </Button>
            <span className="text-[12.5px] text-texto-2">
              {elegidos.size === 0 ? 'Elegí los que querés volver a intentar' : `${elegidos.size} elegidos`}
            </span>
            <Button
              variant="primaria"
              size="sm"
              className="ml-auto"
              disabled={pendiente || elegidos.size === 0}
              onClick={() =>
                iniciar(async () => {
                  const r = await recuperarLeads([...elegidos])
                  if (r.ok) {
                    toast.success(`${r.recuperados} leads vuelven al pozo`)
                    setElegidos(new Set())
                    router.refresh()
                  } else toast.error(r.error ?? 'No se pudo.')
                })
              }
            >
              <RotateCcw aria-hidden />
              Devolver al pozo
            </Button>
          </div>
        ) : null}

        {filas.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <Inbox className="mb-2 h-5 w-5 text-texto-2" aria-hidden />
            <p className="text-[13px] text-texto-2">
              {vista === 'respondieron'
                ? 'No hay nadie esperando que lo atiendas. Cuando un setter marque una respuesta, aparece acá.'
                : 'No hay leads en esta vista con los filtros elegidos.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-borde/60">
            {filas.map((f) => (
              <div
                key={f.assignmentId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
              >
                {recuperable ? (
                  <input
                    type="checkbox"
                    checked={elegidos.has(f.assignmentId)}
                    onChange={() => alternar(f.assignmentId)}
                    aria-label={`Elegir ${f.businessName}`}
                    className="h-4 w-4 shrink-0 accent-[#0066FF]"
                  />
                ) : null}

                <span className="min-w-[160px] flex-1">
                  <Link
                    href={`/contactos?buscar=${encodeURIComponent(f.businessName)}` as never}
                    className="block truncate text-[13px] text-texto hover:underline"
                  >
                    {f.businessName}
                  </Link>
                  <span className="dato text-[11.5px] text-texto-2">
                    {f.igUsername ? `@${f.igUsername}` : 'sin Instagram'}
                    {f.niche ? ` · ${f.niche}` : ''}
                    {f.city ? ` · ${f.city}` : ''}
                  </span>
                </span>

                <span className="w-[110px] shrink-0 truncate text-[12px] text-texto-2">
                  {f.setterNombre ?? '—'}
                </span>

                <span className="w-[150px] shrink-0 text-[11.5px] text-texto-2">
                  {DETALLE[vista](f)}
                </span>

                {f.interes ? (
                  <Chip tono={INTERES_META[f.interes].tone}>{INTERES_META[f.interes].label}</Chip>
                ) : (
                  <Chip tono={LEAD_ESTADO_META[f.estado].tone}>
                    {LEAD_ESTADO_META[f.estado].label}
                  </Chip>
                )}

                {vista === 'sin_contactar' ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <select
                      defaultValue=""
                      disabled={pendiente}
                      onChange={(e) => {
                        const destino = e.target.value
                        e.target.value = ''
                        if (destino) {
                          correr(() => reasignar(f.assignmentId, destino), 'Reasignado')
                        }
                      }}
                      className="h-7 rounded-[4px] border border-borde bg-fondo px-1.5 text-[11.5px] text-texto"
                      aria-label="Reasignar a otro setter"
                    >
                      <option value="">Reasignar a…</option>
                      {setters
                        .filter((s) => s.id !== f.setterId && s.estado === 'activo')
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.nombre}
                          </option>
                        ))}
                    </select>
                    <Button
                      variant="fantasma"
                      size="sm"
                      disabled={pendiente}
                      onClick={() =>
                        correr(() => devolverAlPozo(f.assignmentId), 'Devuelto al pozo')
                      }
                    >
                      Al pozo
                    </Button>
                    <Button
                      variant="fantasma"
                      size="sm"
                      disabled={pendiente}
                      title="Sale de la cola del setter y pasa a la tuya, en el Despachador."
                      onClick={() => correr(() => tomarLead(f.assignmentId), 'Lo tomaste vos')}
                    >
                      Tomarlo
                    </Button>
                  </span>
                ) : null}

                {f.nota ? (
                  <span className="w-full text-[11.5px] text-texto-2">
                    Nota: <span className="text-texto">{f.nota}</span>
                  </span>
                ) : null}
                {vista === 'vencidos' && f.devueltoMotivo ? (
                  <span className="w-full text-[11.5px] text-texto-2">{f.devueltoMotivo}</span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

/** Qué dato importa en cada vista. Mostrar todos sería no mostrar ninguno. */
const DETALLE: Record<Vista, (f: FilaVista) => string> = {
  respondieron: (f) => `esperando ${haceCuanto(f.respondidoAt).replace('hace ', '')}`,
  oferta: (f) =>
    `${f.interes ? INTERES_META[f.interes].label : 'contestó'} · ${haceCuanto(f.respondidoAt)}`,
  sin_contactar: (f) => (f.horas === 0 ? 'vence en menos de 1 h' : `vence en ${f.horas} h`),
  sin_respuesta: (f) => `sin contestar desde ${haceCuanto(f.segundoMensajeAt)}`,
  esperando_segundo: (f) =>
    f.dias === 0 ? 'le toca hoy' : `${f.dias} ${f.dias === 1 ? 'día' : 'días'} de atraso`,
  vencidos: (f) => `asignado ${formatCorto(f.asignadoAt)}`,
  inexistentes: (f) => `marcado ${formatCorto(f.asignadoAt)}`,
}

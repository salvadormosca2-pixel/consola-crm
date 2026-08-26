import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { Chip, Metrica, Panel, PanelHeader } from '@/components/ui/panel'
import { USER_STATUS_META } from '@/db/enums'
import { formatCorto, haceCuanto } from '@/lib/tz'
import { cn } from '@/lib/utils'
import { requerirAdmin } from '@/server/session'
import {
  conteosDeFicha,
  leerFicha,
  listarSeccion,
  SECCIONES_FICHA,
  type FilaDeSeccion,
  type NumerosDeSetter,
  type SeccionFicha,
} from '@/server/setters/panel'

import { Acciones } from './acciones'
import { Ajustes } from './ajustes'

export const metadata: Metadata = { title: 'Setter · 101leads' }
export const dynamic = 'force-dynamic'

const SECCION_META: Record<SeccionFicha, { label: string; vacio: string }> = {
  resumen: { label: 'Resumen', vacio: '' },
  enviados: {
    label: 'Mensajes enviados',
    vacio: 'Todavía no mandó ningún mensaje.',
  },
  primero: {
    label: 'Respondieron 1er mensaje',
    vacio: 'Nadie respondió todavía el primer mensaje.',
  },
  oferta: {
    label: 'Respondieron 2do mensaje',
    vacio: 'Todavía nadie respondió el segundo mensaje.',
  },
  reuniones: {
    label: 'Reuniones',
    vacio: 'Todavía no consiguió ninguna reunión.',
  },
}

function seccionValida(valor: string | undefined): SeccionFicha {
  return SECCIONES_FICHA.includes(valor as SeccionFicha) ? (valor as SeccionFicha) : 'resumen'
}

/**
 * La ficha de un setter, partida en pestañas.
 *
 * Antes era una sola pantalla con todo encima y no se entendía nada. Ahora cada
 * pregunta tiene su lugar: cuánto mandó, a quién, quién contestó el primero,
 * quién contestó la oferta, y qué reuniones consiguió. Una lista por vez.
 */
export default async function PaginaSetter({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ ver?: string }>
}) {
  const sesion = await requerirAdmin()
  const { id } = await params
  const { ver } = await searchParams
  const seccion = seccionValida(ver)

  const ficha = await leerFicha(id)
  if (!ficha) notFound()

  const conteos = await conteosDeFicha(id)
  const filas = seccion === 'resumen' ? [] : await listarSeccion(id, seccion)

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      {/* ── Quién es ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/equipo" className="text-[12.5px] text-texto-2 hover:text-texto">
            ← Equipo
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-[22px]">{ficha.nombre}</h1>
            {ficha.estado !== 'activo' ? (
              <Chip tono={USER_STATUS_META[ficha.estado].tone}>
                {USER_STATUS_META[ficha.estado].label}
              </Chip>
            ) : null}
            {ficha.debeCambiarPassword ? <Chip tono="activo">Sin entrar todavía</Chip> : null}
          </div>
          <p className="mt-1 text-[12.5px] text-texto-2">
            {ficha.email} ·{' '}
            {ficha.ultimoIngreso ? `entró ${haceCuanto(ficha.ultimoIngreso)}` : 'nunca entró'}
          </p>
        </div>

        <Acciones
          setterId={ficha.setterId}
          nombre={ficha.nombre}
          estado={ficha.estado}
          esAdminMadre={sesion.rol === 'admin_madre'}
        />
      </div>

      {/* ── Los cuatro números de hoy ───────────────────────────────── */}
      <Panel>
        <div className="grid grid-cols-2 gap-4 px-4 py-4 sm:grid-cols-4">
          <Metrica rotulo="Mensajes hoy" valor={ficha.dia.contactados + ficha.dia.segundos} />
          <Metrica rotulo="Sin contactar" valor={ficha.sinContactar} />
          <Metrica
            rotulo="Seguimientos pendientes"
            valor={ficha.seguimientosPendientes}
            tono={ficha.seguimientosPendientes > 0 ? 'ambar' : undefined}
          />
          <Metrica
            rotulo="Días de atraso"
            valor={ficha.diasAtraso}
            tono={ficha.diasAtraso >= 3 ? 'rojo' : undefined}
          />
        </div>
      </Panel>

      {/* ── Pestañas ────────────────────────────────────────────────── */}
      <nav className="flex flex-wrap gap-1" aria-label="Secciones de la ficha">
        {SECCIONES_FICHA.map((s) => (
          <Link
            key={s}
            href={(s === 'resumen' ? `/equipo/${id}` : `/equipo/${id}?ver=${s}`) as never}
            aria-current={s === seccion ? 'page' : undefined}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-[8px] border px-3 text-[13px] font-medium',
              'transition-colors duration-150',
              s === seccion
                ? 'border-acento/40 bg-acento-tenue text-acento'
                : 'border-borde bg-superficie text-texto-2 hover:text-texto',
            )}
          >
            {SECCION_META[s].label}
            {s !== 'resumen' ? (
              <span className="dato text-[12px] opacity-70">{conteos[s]}</span>
            ) : null}
          </Link>
        ))}
      </nav>

      {seccion === 'resumen' ? (
        <Resumen ficha={ficha} />
      ) : (
        <Lista filas={filas} vacio={SECCION_META[seccion].vacio} />
      )}
    </div>
  )
}

/* ── Una lista, y nada más ────────────────────────────────────────────── */

function Lista({ filas, vacio }: { filas: FilaDeSeccion[]; vacio: string }) {
  if (filas.length === 0) {
    return (
      <Panel className="px-6 py-12 text-center">
        <p className="text-[13.5px] text-texto-2">{vacio}</p>
      </Panel>
    )
  }

  return (
    <Panel className="overflow-hidden">
      <div className="divide-y divide-borde">
        {filas.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
            <span className="dato w-[104px] shrink-0 text-[12.5px] text-texto-2">
              {formatCorto(f.cuando)}
            </span>

            <span className="min-w-[180px] flex-1">
              <span className="block truncate text-[13.5px] text-texto">{f.businessName}</span>
              <span className="dato block truncate text-[12px] text-texto-2">
                {f.igUsername ? `@${f.igUsername}` : 'sin Instagram'}
                {f.niche ? ` · ${f.niche}` : ''}
              </span>
            </span>

            {f.detalle ? (
              <Chip
                tono={
                  f.detalle === 'Le interesa'
                    ? 'positivo'
                    : f.detalle === 'No le interesa'
                      ? 'negativo'
                      : 'neutral'
                }
              >
                {f.detalle}
              </Chip>
            ) : null}

            {f.extra ? (
              <span className="w-full text-[12px] text-texto-2 sm:w-auto sm:max-w-[280px] sm:truncate">
                {f.extra}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </Panel>
  )
}

/* ── Resumen ──────────────────────────────────────────────────────────── */

function Resumen({
  ficha,
}: {
  ficha: NonNullable<Awaited<ReturnType<typeof leerFicha>>>
}) {
  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          titulo="Sus cuentas de Instagram"
          descripcion="Cupo de hoy y tasa de respuesta de la semana."
        />
        <div className="divide-y divide-borde">
          {ficha.cuentas.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-texto-2">
              No tiene cuentas cargadas. Sin cuentas no puede trabajar.
            </p>
          ) : (
            ficha.cuentas.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    c.salud === 'verde' ? 'bg-verde' : c.salud === 'rojo' ? 'bg-rojo' : 'bg-ambar',
                  )}
                  aria-hidden
                />
                <span className="dato w-[160px] shrink-0 text-[13.5px] text-texto">
                  @{c.igUsername}
                </span>
                <span
                  className={cn(
                    'dato w-[90px] shrink-0 text-[13px]',
                    c.enviadosHoy >= c.cupoDiario ? 'text-rojo' : 'text-texto-2',
                  )}
                >
                  {c.enviadosHoy}/{c.cupoDiario} hoy
                </span>
                {!c.activa ? <Chip>Desactivada</Chip> : null}
                <span className="min-w-0 flex-1 text-[12.5px] text-texto-2">{c.motivoSalud}</span>
              </div>
            ))
          )}
        </div>
      </Panel>

      <Ajustes
        setterId={ficha.setterId}
        nombre={ficha.nombre}
        tandaDiaria={ficha.tandaDiaria}
        recordatorioAutomatico={ficha.recordatorioAutomatico}
        horaRecordatorio={ficha.horaRecordatorio}
        cuentas={ficha.cuentas.map((c) => ({
          id: c.id,
          usuario: c.igUsername,
          cupo: c.cupoDiario,
          activa: c.activa,
        }))}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Numeros titulo="Hoy" n={ficha.dia} />
        <Numeros titulo="Últimos 7 días" n={ficha.semana} />
        <Numeros titulo="Últimos 30 días" n={ficha.mes} />
      </div>
    </div>
  )
}

function Numeros({ titulo, n }: { titulo: string; n: NumerosDeSetter }) {
  return (
    <Panel>
      <PanelHeader titulo={titulo} />
      <div className="grid grid-cols-2 gap-4 px-4 py-4">
        <Metrica rotulo="Contactados" valor={n.contactados} />
        <Metrica rotulo="Segundos mensajes" valor={n.segundos} />
        <Metrica rotulo="Respondieron" valor={n.respondieron} tono="verde" />
        <Metrica rotulo="Reuniones" valor={n.reuniones} tono="verde" />
        <Metrica rotulo="Cerrados" valor={n.cerrados} tono="verde" />
        <Metrica
          rotulo="Tasa de respuesta"
          valor={n.tasa === null ? '—' : (n.tasa * 100).toFixed(1)}
          sufijo={n.tasa === null ? undefined : '%'}
          tono={n.tasa !== null && n.tasa < 0.05 ? 'rojo' : undefined}
        />
      </div>
    </Panel>
  )
}

import { CalendarDays } from 'lucide-react'
import Link from 'next/link'
import type { Metadata } from 'next'

import { EmptyState } from '@/components/ui/empty-state'
import { Chip, Panel, PanelHeader } from '@/components/ui/panel'
import { MEETING_STATUSES, type MeetingStatus } from '@/db/enums'
import { formatCorto, opsDate, OPS_TZ } from '@/lib/tz'
import { cn } from '@/lib/utils'
import { requerirAdmin } from '@/server/session'
import { listarSettersActivos } from '@/server/setters/panel'
import { listarReuniones, VISTAS_REUNION, type VistaReunion } from '@/server/setters/reuniones'

export const metadata: Metadata = { title: 'Reuniones · 101leads' }
export const dynamic = 'force-dynamic'

const ETIQUETA_VISTA: Record<VistaReunion, string> = {
  dia: 'Día',
  semana: 'Semana',
  lista: 'Lo que viene',
}

const TONO_ESTADO: Record<MeetingStatus, 'neutral' | 'activo' | 'positivo' | 'negativo'> = {
  agendada: 'activo',
  confirmada: 'activo',
  hecha: 'positivo',
  no_asistio: 'negativo',
  reprogramada: 'neutral',
  cancelada: 'negativo',
}

const ETIQUETA_ESTADO: Record<MeetingStatus, string> = {
  agendada: 'Agendada',
  confirmada: 'Confirmada',
  hecha: 'Hecha',
  no_asistio: 'No asistió',
  reprogramada: 'Reprogramada',
  cancelada: 'Cancelada',
}

/**
 * Todas las reuniones agendadas, con el setter que las consiguió. Las de las
 * próximas 24 horas van destacadas, porque son las únicas sobre las que puedo
 * hacer algo hoy.
 */
export default async function PaginaReuniones({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string; dia?: string; setter?: string }>
}) {
  await requerirAdmin()
  const { ver, dia, setter } = await searchParams

  const vista = (VISTAS_REUNION.includes(ver as VistaReunion) ? ver : 'lista') as VistaReunion
  const ancla = /^\d{4}-\d{2}-\d{2}$/.test(dia ?? '') ? dia! : opsDate()

  const [filas, setters] = await Promise.all([
    listarReuniones({ vista, ancla, setterId: setter || null }),
    listarSettersActivos(),
  ])

  const inminentes = filas.filter((f) => f.inminente).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px]">Reuniones</h1>
          <p className="mt-0.5 text-[12.5px] text-texto-2">
            {inminentes > 0
              ? `${inminentes} en las próximas 24 horas.`
              : 'Las llamadas y visitas agendadas, con quién las consiguió.'}
          </p>
        </div>

        <nav className="flex gap-1" aria-label="Vista del calendario">
          {VISTAS_REUNION.map((v) => (
            <Link
              key={v}
              href={
                `/reuniones?ver=${v}${dia ? `&dia=${dia}` : ''}${setter ? `&setter=${setter}` : ''}` as never
              }
              aria-current={v === vista ? 'page' : undefined}
              className={cn(
                'flex h-7.5 items-center rounded-[5px] border px-3 text-[12.5px] font-medium',
                v === vista
                  ? 'border-acento/40 bg-acento-tenue text-acento'
                  : 'border-borde bg-elevada text-texto-2 hover:text-texto',
              )}
            >
              {ETIQUETA_VISTA[v]}
            </Link>
          ))}
        </nav>
      </div>

      {setters.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          <Filtro href={`/reuniones?ver=${vista}`} activo={!setter} texto="Todos" />
          {setters.map((s) => (
            <Filtro
              key={s.id}
              href={`/reuniones?ver=${vista}&setter=${s.id}`}
              activo={setter === s.id}
              texto={s.nombre}
            />
          ))}
        </div>
      ) : null}

      {filas.length === 0 ? (
        <Panel>
          <EmptyState
            icono={CalendarDays}
            titulo={vista === 'lista' ? 'No hay reuniones por delante' : 'No hay reuniones acá'}
            detalle="Cuando un setter agende una desde su app, aparece en el momento, asociada a él."
          />
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <PanelHeader
            titulo={
              vista === 'dia'
                ? `Día ${ancla.split('-').reverse().join('/')}`
                : vista === 'semana'
                  ? 'Semana'
                  : 'Próximas'
            }
            descripcion={`${filas.length} ${filas.length === 1 ? 'reunión' : 'reuniones'}`}
          />

          <div className="divide-y divide-borde/60">
            {filas.map((f) => (
              <div
                key={f.id}
                className={cn(
                  'flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2',
                  f.inminente && 'bg-ambar-tenue',
                )}
              >
                <span
                  className={cn(
                    'dato w-[104px] shrink-0 text-[12.5px]',
                    f.inminente ? 'text-ambar' : 'text-texto',
                  )}
                >
                  {new Intl.DateTimeFormat('es-AR', {
                    timeZone: OPS_TZ,
                    weekday: 'short',
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  }).format(f.scheduledAt)}
                </span>

                <span className="min-w-[160px] flex-1">
                  <Link
                    href={`/contactos?buscar=${encodeURIComponent(f.businessName)}` as never}
                    className="block truncate text-[13px] text-texto hover:underline"
                  >
                    {f.businessName}
                  </Link>
                  <span className="dato text-[11.5px] text-texto-2">
                    {f.igUsername ? `@${f.igUsername}` : (f.phoneE164 ?? 'sin contacto')}
                  </span>
                </span>

                <span className="w-[110px] shrink-0 truncate text-[12px] text-texto-2">
                  {f.setterNombre ? `la trajo ${f.setterNombre}` : '—'}
                </span>

                <span className="w-[80px] shrink-0 text-[12px] text-texto-2">
                  {f.type === 'llamada'
                    ? 'Llamada'
                    : f.type === 'videollamada'
                      ? 'Videollamada'
                      : 'Presencial'}
                </span>

                <Chip tono={TONO_ESTADO[f.status]}>{ETIQUETA_ESTADO[f.status]}</Chip>

                {f.notes ? (
                  <span className="w-full text-[11.5px] text-texto-2">{f.notes}</span>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <p className="px-1 text-[11px] text-texto-2">
        Los estados posibles son: {MEETING_STATUSES.map((s) => ETIQUETA_ESTADO[s]).join(' · ')}.
        Se cambian desde la ficha del contacto. Última actualización {formatCorto(new Date())}.
      </p>
    </div>
  )
}

function Filtro({ href, activo, texto }: { href: string; activo: boolean; texto: string }) {
  return (
    <Link
      href={href as never}
      aria-current={activo ? 'page' : undefined}
      className={cn(
        'flex h-7 items-center rounded-[4px] border px-2.5 text-[12px]',
        activo ? 'border-acento/40 bg-acento-tenue text-acento' : 'border-borde bg-elevada text-texto-2',
      )}
    >
      {texto}
    </Link>
  )
}

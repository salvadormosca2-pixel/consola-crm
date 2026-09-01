import { Instagram, Megaphone, Plus, Repeat, UserCog } from 'lucide-react'
import Link from 'next/link'
import type { Metadata } from 'next'

import { EmptyState } from '@/components/ui/empty-state'
import { Chip, Panel, PanelHeader } from '@/components/ui/panel'
import { USER_STATUS_META } from '@/db/enums'
import { haceCuanto } from '@/lib/tz'
import { cn } from '@/lib/utils'
import { clavePublica } from '@/server/push'
import { requerirAdmin } from '@/server/session'
import { leerConfigNotificaciones } from '@/server/setters/notificaciones'
import { contarParaVaciar } from '@/server/setters/borrar'
import { armarTablero, listarDeBaja, type FilaTablero } from '@/server/setters/panel'
import { proponerReparto, repartoAutomaticoDelDia } from '@/server/setters/reparto'

import { Accesos, type SetterParaAcceso } from './accesos'
import { AvisosQueQuiero } from './avisos-que-quiero'
import { Reparto } from './reparto'
import { Vaciar } from './vaciar'

export const metadata: Metadata = { title: 'Equipo · 101leads' }
export const dynamic = 'force-dynamic'

/**
 * El tablero del día: una línea por setter.
 *
 * Es mi pantalla de entrada. De un vistazo tengo que ver quién trabajó hoy y
 * quién no, sin abrir nada. El semáforo de la derecha lleva el motivo escrito
 * al lado: un color sin explicación no sirve para decidir nada.
 */
export default async function PaginaEquipo() {
  const sesion = await requerirAdmin()

  // La tanda del día, si todavía no salió. No espera a ningún cron: el primero
  // que abre una pantalla después de la hora la dispara, y como mucho sale una
  // vez por día. Va antes del tablero para que lo que se ve ya la incluya.
  await repartoAutomaticoDelDia()

  const [filas, plan, avisos, bajas, paraVaciar] = await Promise.all([
    armarTablero(),
    proponerReparto(),
    leerConfigNotificaciones(),
    listarDeBaja(),
    contarParaVaciar(),
  ])

  const atrasados = filas.filter((f) => f.semaforo === 'rojo').length

  // Los accesos son de quien todavía tiene que entrar: al que está de baja no
  // le sirve una contraseña nueva, no puede entrar igual.
  const paraAcceso: SetterParaAcceso[] = filas
    .filter((f) => f.estado !== 'baja')
    .map((f) => ({
      setterId: f.setterId,
      nombre: f.nombre,
      email: f.email,
      nuncaEntro: f.ultimoIngreso === null,
    }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px]">Equipo</h1>
          <p className="mt-1 text-[13px] text-texto-2">
            Qué hizo cada uno hoy.{' '}
            {plan.pozo === 0
              ? 'No quedan leads sin asignar.'
              : `${plan.pozo} leads en el pozo esperando reparto.`}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Atajo
            href="/equipo/seguimientos"
            icono={Repeat}
            texto="Control de seguimientos"
            alerta={atrasados}
          />
          <Atajo href="/equipo/leads" icono={UserCog} texto="Vistas de leads" />
          <Atajo href="/equipo/instagram" icono={Instagram} texto="Cuentas de Instagram" />
          <Atajo href="/equipo/avisos" icono={Megaphone} texto="Mensajes al equipo" />
          {sesion.rol === 'admin_madre' ? (
            <Link
              href="/equipo/nuevo"
              className="flex h-7.5 items-center gap-1.5 rounded-[5px] bg-acento-solido px-3 text-[12.5px] font-semibold text-white hover:bg-acento"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Nuevo setter
            </Link>
          ) : null}
        </div>
      </div>

      {filas.length === 0 ? (
        <Panel>
          <EmptyState
            icono={UserCog}
            titulo="Todavía no hay setters"
            detalle={
              sesion.rol === 'admin_madre'
                ? 'Creá el primero: cargás su nombre, su email y sus cuentas de Instagram, y obtenés una tarjeta con el acceso lista para mandarle por WhatsApp.'
                : 'Todavía no se dio de alta a nadie. La cuenta principal es la que puede crear setters.'
            }
            accion={
              sesion.rol === 'admin_madre'
                ? { texto: 'Crear el primer setter', href: '/equipo/nuevo' }
                : undefined
            }
          />
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="hidden grid-cols-[1.4fr_1.5fr_0.8fr_0.9fr_0.6fr_0.6fr_1fr] gap-2 border-b border-borde px-3 py-1.5 sm:grid">
            <span className="rotulo">Setter</span>
            <span className="rotulo">Cuentas</span>
            <span className="rotulo">Hoy</span>
            <span className="rotulo">Seguim.</span>
            <span className="rotulo">Resp.</span>
            <span className="rotulo">Reun.</span>
            <span className="rotulo">Estado</span>
          </div>

          <div className="divide-y divide-borde/60">
            {filas.map((f) => (
              <Fila key={f.setterId} f={f} />
            ))}
          </div>
        </Panel>
      )}

      <Accesos setters={paraAcceso} esAdminMadre={sesion.rol === 'admin_madre'} />

      {filas.length > 0 ? <Reparto plan={plan} /> : null}

      {bajas.length > 0 ? (
        <Panel>
          <PanelHeader
            titulo="Dados de baja"
            descripcion="No entran ni reciben leads. Su historial y su comisión siguen contando; se entra a la ficha para reactivarlos o para borrar un alta equivocada."
          />
          <div className="divide-y divide-borde/60">
            {bajas.map((b) => (
              <Link
                key={b.setterId}
                href={`/equipo/${b.setterId}` as never}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 hover:bg-elevada/50"
              >
                <span className="text-[13px] text-texto">{b.nombre}</span>
                <span className="text-[11.5px] text-texto-2">{b.email}</span>
                {b.sinHistorial ? (
                  <Chip tono="neutral" className="ml-auto">
                    Nunca trabajó
                  </Chip>
                ) : null}
              </Link>
            ))}
          </div>
        </Panel>
      ) : null}

      <AvisosQueQuiero inicial={avisos} pushDisponible={clavePublica() !== null} />

      {sesion.rol === 'admin_madre' ? <Vaciar resumen={paraVaciar} /> : null}
    </div>
  )
}

function Atajo({
  href,
  icono: Icono,
  texto,
  alerta = 0,
}: {
  href: string
  icono: typeof Repeat
  texto: string
  alerta?: number
}) {
  return (
    <Link
      href={href as never}
      className="flex h-7.5 items-center gap-1.5 rounded-[5px] border border-borde bg-elevada px-3 text-[12.5px] font-medium text-texto hover:bg-elevada"
    >
      <Icono className="h-3.5 w-3.5 text-texto-2" aria-hidden />
      {texto}
      {alerta > 0 ? (
        <span className="dato rounded-[3px] bg-rojo px-1 text-[10px] leading-4 text-white">
          {alerta}
        </span>
      ) : null}
    </Link>
  )
}

const COLOR: Record<'verde' | 'amarillo' | 'rojo', string> = {
  verde: 'bg-verde',
  amarillo: 'bg-ambar',
  rojo: 'bg-rojo',
}

function Fila({ f }: { f: FilaTablero }) {
  const cuentas = f.cupo?.cuentas.filter((c) => c.activa) ?? []

  return (
    <Link
      href={`/equipo/${f.setterId}` as never}
      className="grid grid-cols-2 gap-2 px-3 py-2 transition-colors duration-150 hover:bg-elevada/50 sm:grid-cols-[1.4fr_1.5fr_0.8fr_0.9fr_0.6fr_0.6fr_1fr] sm:items-center"
    >
      <span className="min-w-0">
        <span className="block truncate text-[13px] text-texto">{f.nombre}</span>
        {f.estado !== 'activo' ? (
          <Chip tono={USER_STATUS_META[f.estado].tone} className="mt-0.5">
            {USER_STATUS_META[f.estado].label}
          </Chip>
        ) : (
          <span className="block text-[11px] text-texto-2">
            {f.ultimoIngreso ? `entró ${haceCuanto(f.ultimoIngreso)}` : 'nunca entró'}
          </span>
        )}
      </span>

      <span className="dato flex flex-wrap gap-x-2 gap-y-0.5 text-[11.5px] text-texto-2">
        {cuentas.length === 0 ? (
          <span className="text-rojo">sin cuentas</span>
        ) : (
          cuentas.map((c) => (
            <span key={c.id} className={cn(c.alTope && 'text-rojo')}>
              @{c.igUsername} {c.enviadosHoy}/{c.cupoDiario}
            </span>
          ))
        )}
      </span>

      <span className="dato text-[12.5px] text-texto">
        {f.hoy}
        <span className="text-texto-2">/{f.tanda}</span>
      </span>

      <span className="dato text-[12.5px] text-texto">
        {f.seguimientosHechos}
        <span className="text-texto-2">/{f.seguimientosHechos + f.seguimientosPendientes}</span>
        {f.diasAtraso > 0 ? <span className="ml-1 text-rojo">{f.diasAtraso}d</span> : null}
      </span>

      <span className="dato text-[12.5px] text-texto">{f.respondieron}</span>
      <span className="dato text-[12.5px] text-texto">{f.reuniones}</span>

      <span className="flex items-center gap-1.5">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', COLOR[f.semaforo])} aria-hidden />
        <span className="truncate text-[11.5px] text-texto-2">{f.motivo}</span>
      </span>
    </Link>
  )
}

import { Instagram, MessageCircle } from 'lucide-react'
import Link from 'next/link'
import type { Metadata } from 'next'

import { AvisoDemo } from '@/components/aviso-demo'
import { CapMeter } from '@/components/cap-meter'
import { Panel } from '@/components/ui/panel'
import { leerCupos } from '@/server/accounts'
import { leerConfigChatwoot } from '@/server/chatwoot/config'
import { armarCola } from '@/server/dispatch'
import { armarSeguimientos } from '@/server/followups'

import { Cola } from '../despachador/cola'

export const metadata: Metadata = { title: 'Seguimientos · Consola' }
export const dynamic = 'force-dynamic'

/**
 * Seguimientos.
 *
 * Es el mismo despachador que la pantalla principal —mismo mensaje armado,
 * mismos cupos, mismos atajos— pero acotado a los que **ya recibieron un
 * mensaje**. Separarlo tiene una razón comercial: el primer contacto y el
 * seguimiento son dos trabajos distintos y se hacen en momentos distintos del
 * día. Mezclarlos hace que los seguimientos siempre queden para después, y ahí
 * es donde se pierden las ventas.
 */
export default async function PaginaSeguimientos({
  searchParams,
}: {
  searchParams: Promise<{ canal?: string }>
}) {
  const { canal: crudo } = await searchParams
  const canal = crudo === 'instagram' ? 'instagram' : 'whatsapp'

  const [cuentas, cola, chatwootListo] = await Promise.all([
    leerCupos(),
    armarCola(canal, 'seguimientos'),
    leerConfigChatwoot().then((c) => c !== null),
  ])
  const panel = await armarSeguimientos(chatwootListo)
  const delCanal = cuentas.filter((c) => c.channel === canal)

  const pendientes = panel.totales.vencido + panel.totales.hoy

  return (
    <div className="space-y-3">
      <AvisoDemo />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[20px]">Seguimientos</h1>
          <p className="mt-0.5 text-[12.5px] text-texto-2">
            Los que ya recibieron un mensaje y todavía no contestaron.
          </p>
        </div>
        <CapMeter cuentas={delCanal} />
      </div>

      <nav className="flex gap-0.5 border-b border-borde" aria-label="Canal">
        <Solapa
          href="/seguimientos"
          activa={canal === 'whatsapp'}
          icono={<MessageCircle className="h-3.5 w-3.5" aria-hidden />}
          texto="WhatsApp"
        />
        <Solapa
          href="/seguimientos?canal=instagram"
          activa={canal === 'instagram'}
          icono={<Instagram className="h-3.5 w-3.5" aria-hidden />}
          texto="Instagram"
        />
      </nav>

      {/* Resumen corto de dónde está la gente. Si el 80% muere en el paso 1, el
          problema es el mensaje de apertura, no la cadencia. */}
      {panel.porPaso.length > 0 ? (
        <Panel className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2">
          {panel.totales.vencido > 0 ? (
            <Dato valor={panel.totales.vencido} texto="atrasados" tono="rojo" />
          ) : null}
          {panel.totales.hoy > 0 ? (
            <Dato valor={panel.totales.hoy} texto="para hoy" tono="ambar" />
          ) : null}
          {panel.totales.esta_semana > 0 ? (
            <Dato valor={panel.totales.esta_semana} texto="esta semana" />
          ) : null}
          {panel.totales.agotado > 0 ? (
            <Dato
              valor={panel.totales.agotado}
              texto="agotaron los 4 mensajes"
              ayuda="Recibieron toda la secuencia y nunca contestaron. Conviene dejarlos descansar o cerrarlos."
            />
          ) : null}

          <div className="ml-auto flex flex-wrap items-center gap-3">
            {panel.porPaso.map((p) => (
              <span key={p.paso} className="text-[11px] text-texto-2">
                <span className="dato text-texto">{p.n}</span> con {p.paso}{' '}
                {p.paso === 1 ? 'mensaje' : 'mensajes'}
              </span>
            ))}
          </div>
        </Panel>
      ) : null}

      {delCanal.length === 0 ? (
        <Panel className="px-6 py-12 text-center">
          <h2 className="text-[15px]">
            No hay cuentas de {canal === 'whatsapp' ? 'WhatsApp' : 'Instagram'} en condiciones de
            enviar
          </h2>
          <p className="mt-1.5 text-[12.5px] text-texto-2">
            Cargá al menos una cuenta activa, con su checklist de preparación completo.
          </p>
        </Panel>
      ) : cola.items.length === 0 ? (
        <Panel className="px-6 py-14 text-center">
          <h2 className="text-[15px]">
            {pendientes === 0 && panel.totales.esta_semana === 0
              ? 'Todavía no hay seguimientos'
              : 'Nada para mandar hoy'}
          </h2>
          <p className="mt-1.5 max-w-md mx-auto text-[12.5px] leading-relaxed text-texto-2">
            {pendientes === 0 && panel.totales.esta_semana === 0 ? (
              <>
                El seguimiento se programa solo cuando mandás el primer mensaje. Arrancá por el{' '}
                <Link href="/despachador" className="text-ambar underline underline-offset-2">
                  Despachador
                </Link>
                .
              </>
            ) : (
              <>
                Hay {panel.totales.esta_semana} programados para esta semana, pero ninguno vence
                hoy. Volvé mañana o adelantá alguno desde la lista de contactos.
              </>
            )}
          </p>
        </Panel>
      ) : (
        <>
          {cola.totales.sinPlantilla > 0 ? (
            <div className="rounded-[5px] border border-ambar/35 bg-ambar/8 px-2.5 py-1.5 text-[12px]">
              <span className="text-texto">
                {cola.totales.sinPlantilla} no tienen plantilla para su paso de la secuencia.
              </span>{' '}
              <Link href="/plantillas" className="text-ambar underline underline-offset-2">
                Crear la plantilla que falta
              </Link>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-texto-2">
            <span>
              Cupo disponible hoy en este canal:{' '}
              <span className="dato text-texto">{cola.cupoDisponible}</span> mensajes
            </span>
            {cola.totales.saltados > 0 ? (
              <span className="text-ambar">
                {cola.totales.saltados} quedaron fuera porque les falta un dato
              </span>
            ) : null}
          </div>

          <Cola cola={cola} />
        </>
      )}
    </div>
  )
}

function Dato({
  valor,
  texto,
  tono,
  ayuda,
}: {
  valor: number
  texto: string
  tono?: 'rojo' | 'ambar'
  ayuda?: string
}) {
  return (
    <span className="flex items-baseline gap-1.5" title={ayuda}>
      <span
        className={
          'dato text-[18px] leading-none ' +
          (tono === 'rojo' ? 'text-rojo' : tono === 'ambar' ? 'text-ambar' : 'text-texto')
        }
      >
        {valor}
      </span>
      <span className="text-[11.5px] text-texto-2">{texto}</span>
    </span>
  )
}

function Solapa({
  href,
  activa,
  icono,
  texto,
}: {
  href: string
  activa: boolean
  icono: React.ReactNode
  texto: string
}) {
  return (
    <Link
      href={href as never}
      aria-current={activa ? 'page' : undefined}
      className={
        'flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-150 ' +
        (activa ? 'border-ambar text-texto' : 'border-transparent text-texto-2 hover:text-texto')
      }
    >
      {icono}
      {texto}
    </Link>
  )
}

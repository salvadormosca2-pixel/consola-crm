import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { Panel } from '@/components/ui/panel'
import { esClasificacion, type Clasificacion } from '@/lib/seguimientos-vistas'
import { haceCuanto } from '@/lib/tz'
import { leerConfigSetters } from '@/server/setters/config'
import { requerirAdmin } from '@/server/session'
import { fichaDeSeguimientos, leadsDeClasificacion } from '@/server/setters/seguimientos'

import { Clasificaciones } from '../clasificaciones'
import { Reclamo } from './reclamo'

export const metadata: Metadata = { title: 'Seguimientos del setter · 101leads' }
export const dynamic = 'force-dynamic'

/**
 * Cómo viene una persona. Se entra y se sale.
 *
 * Los mismos siete números de la pantalla general, pero solo suyos, y con los
 * mismos rótulos leídos en primera persona: "contactó a 30", "le falta seguir
 * a 12". Tocás cualquiera y se abre la lista de esos clientes.
 */
export default async function PaginaSeguimientosDelSetter({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ ver?: string }>
}) {
  await requerirAdmin()
  const { id } = await params
  const { ver } = await searchParams
  const abierta: Clasificacion | null = esClasificacion(ver) ? ver : null

  const [ficha, cfg] = await Promise.all([fichaDeSeguimientos(id), leerConfigSetters()])
  if (!ficha) notFound()

  const leads = abierta ? await leadsDeClasificacion(abierta, id) : []
  const alerta = ficha.diasAtraso >= cfg.diasAtrasoParaAlerta

  return (
    <div className="space-y-4">
      <div>
        <Link href="/equipo/seguimientos" className="text-[12px] text-texto-2 hover:text-texto">
          ← Seguimientos
        </Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[20px]">{ficha.nombre}</h1>
            <p className="mt-0.5 text-[12.5px] text-texto-2">
              {ficha.ultimaActividad
                ? `Activo ${haceCuanto(ficha.ultimaActividad)}`
                : 'Todavía no mandó ningún mensaje'}
              {alerta ? ` · ${ficha.diasAtraso} días de atraso` : ''}
            </p>
          </div>

          <Reclamo setterId={ficha.setterId} nombre={ficha.nombre} alerta={alerta} />
        </div>
      </div>

      {/* Lo de hoy va aparte de los totales: son dos preguntas distintas.
          Una es "cómo viene el mes", la otra "trabajó hoy o no". */}
      <Panel>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Hoy valor={ficha.hoy} total={ficha.tanda} rotulo="mensajes de entrada hoy" />
          <Hoy valor={ficha.hechosHoy} rotulo="seguimientos hoy" />
          <Link
            href={`/equipo/${ficha.setterId}` as never}
            className="ml-auto text-[12.5px] text-acento hover:underline"
          >
            Ver su ficha completa →
          </Link>
        </div>
      </Panel>

      <Clasificaciones
        conteos={ficha.conteos}
        abierta={abierta}
        leads={leads}
        base={`/equipo/seguimientos/${ficha.setterId}`}
        enSetter
      />
    </div>
  )
}

function Hoy({ valor, total, rotulo }: { valor: number; total?: number; rotulo: string }) {
  return (
    <span className="text-[12px] text-texto-2">
      <span className="dato text-[20px] font-semibold text-texto">{valor}</span>
      {total !== undefined ? <span className="dato text-[13px]">/{total}</span> : null} {rotulo}
    </span>
  )
}

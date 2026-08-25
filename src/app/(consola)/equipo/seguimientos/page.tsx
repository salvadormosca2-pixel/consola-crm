import Link from 'next/link'
import type { Metadata } from 'next'

import { Panel } from '@/components/ui/panel'
import { esClasificacion, type Clasificacion } from '@/lib/seguimientos-vistas'
import { leerConfigSetters } from '@/server/setters/config'
import { requerirAdmin } from '@/server/session'
import { generalDeSeguimientos, leadsDeClasificacion } from '@/server/setters/seguimientos'

import { Clasificaciones } from './clasificaciones'
import { ListaDeSetters } from './lista-de-setters'

export const metadata: Metadata = { title: 'Seguimientos · Ecosystem' }
export const dynamic = 'force-dynamic'

/**
 * El control de seguimientos: lo general, y nada más.
 *
 * Arriba los números de todo el equipo —cuántos faltan por contactar, cuántos
 * se contactaron, cuántos seguimientos se hicieron y cuántos faltan, cuántos
 * contestaron y cuántos están listos para comprar—, y abajo los nombres.
 *
 * El detalle de cada setter **no está acá**: se entra y se sale de su ficha.
 * Una sola pantalla con todo apilado obliga a buscar con el scroll lo que se
 * tiene que poder mirar de un vistazo.
 */
export default async function PaginaSeguimientos({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string }>
}) {
  await requerirAdmin()
  const { ver } = await searchParams
  const abierta: Clasificacion | null = esClasificacion(ver) ? ver : null

  const [general, cfg] = await Promise.all([generalDeSeguimientos(), leerConfigSetters()])
  const leads = abierta ? await leadsDeClasificacion(abierta) : []

  return (
    <div className="space-y-4">
      <div>
        <Link href="/equipo" className="text-[12px] text-texto-2 hover:text-texto">
          ← Equipo
        </Link>
        <h1 className="mt-1 text-[20px]">Seguimientos</h1>
        <p className="mt-0.5 max-w-[720px] text-[12.5px] leading-relaxed text-texto-2">
          Cómo viene el equipo. Tocá cualquier número para ver de qué está hecho, y un nombre para
          entrar a su ficha. A los {cfg.diasAtrasoParaAlerta} días de atraso me llega la alerta.
        </p>
      </div>

      {general.setters.length === 0 ? (
        <Panel className="px-4 py-8 text-center">
          <p className="text-[13px] text-texto-2">
            No hay setters activos. Creá uno desde el tablero del equipo.
          </p>
        </Panel>
      ) : (
        <>
          <Clasificaciones
            conteos={general.conteos}
            abierta={abierta}
            leads={leads}
            base="/equipo/seguimientos"
          />

          <ListaDeSetters
            setters={general.setters}
            diasParaAlerta={cfg.diasAtrasoParaAlerta}
            atrasadosEnTotal={general.conteos.atrasados}
          />
        </>
      )}
    </div>
  )
}

import type { Metadata } from 'next'
import { Radio } from 'lucide-react'

import { CapMeter } from '@/components/cap-meter'
import { EmptyState } from '@/components/ui/empty-state'
import { Panel } from '@/components/ui/panel'
import { listarCuentas } from '@/server/accounts'

import { TablaConciliacion } from './conciliacion'
import { BotonNuevaCuenta, TablaCuentas } from './tabla'

export const metadata: Metadata = { title: 'Cuentas · Consola' }
export const dynamic = 'force-dynamic'

export default async function PaginaCuentas() {
  const cuentas = await listarCuentas()

  const activas = cuentas.filter((c) => c.status === 'activa' || c.status === 'calentando')
  const capTotal = activas.reduce((a, c) => a + c.cap, 0)
  const pendientesTotal = cuentas.reduce((a, c) => a + c.pendientes, 0)
  const enRojo = cuentas.filter((c) => c.salud === 'rojo')

  return (
    <div className="space-y-3">
      {/* Aviso arriba de todo: una cuenta caída no se puede descubrir revisando
          la tabla, tiene que saltar a la vista al entrar. */}
      {enRojo.length > 0 ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[5px] border border-rojo/40 bg-rojo/10 px-3 py-2"
        >
          <span className="dato text-[11px] font-semibold uppercase tracking-wider text-rojo">
            Atención
          </span>
          <span className="text-[12.5px] text-texto">
            {enRojo.length === 1
              ? `${enRojo[0]!.code} necesita revisión: ${enRojo[0]!.saludMotivo.toLowerCase()}`
              : `${enRojo.length} cuentas necesitan revisión: ${enRojo.map((c) => c.code).join(', ')}.`}
          </span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[20px]">Cuentas</h1>
          <p className="mt-0.5 text-[12.5px] text-texto-2">
            Los números y usuarios desde los que sale cada mensaje.
          </p>
        </div>
        <div className="flex items-end gap-5">
          <CapMeter cuentas={cuentas} />
          <BotonNuevaCuenta />
        </div>
      </div>

      {cuentas.length === 0 ? (
        <Panel>
          <EmptyState
            icono={Radio}
            titulo="Todavía no cargaste ninguna cuenta"
            detalle={
              <>
                Cargá acá tus números de WhatsApp y tus usuarios de Instagram. Sin al menos una cuenta
                activa, el importador no va a poder repartir los contactos.
              </>
            }
          />
          <div className="border-t border-borde px-4 py-3 text-center">
            <BotonNuevaCuenta />
          </div>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tarjeta rotulo="Cuentas" valor={cuentas.length} sufijo={`${activas.length} activas`} />
            <Tarjeta rotulo="Cupo diario total" valor={capTotal} sufijo="mensajes por día" tono="ambar" />
            <Tarjeta
              rotulo="Contactos pendientes"
              valor={pendientesTotal}
              sufijo="sin primer mensaje"
            />
            <Tarjeta
              rotulo="Días para terminar"
              valor={capTotal > 0 && pendientesTotal > 0 ? Math.ceil(pendientesTotal / capTotal) : '—'}
              sufijo="al ritmo actual"
            />
          </div>

          <TablaCuentas cuentas={cuentas} />
          <TablaConciliacion />
        </>
      )}
    </div>
  )
}

function Tarjeta({
  rotulo,
  valor,
  sufijo,
  tono,
}: {
  rotulo: string
  valor: number | string
  sufijo: string
  tono?: 'ambar'
}) {
  return (
    <Panel className="px-3 py-2">
      <div className="rotulo truncate">{rotulo}</div>
      <div
        className={`dato mt-1 text-[22px] font-medium leading-none ${
          tono === 'ambar' ? 'text-ambar' : 'text-texto'
        }`}
      >
        {valor}
      </div>
      <div className="mt-1 truncate text-[10.5px] text-texto-2">{sufijo}</div>
    </Panel>
  )
}

import type { Metadata } from 'next'

import { Panel } from '@/components/ui/panel'
import { clavePublica } from '@/server/push'
import { requerirSetter } from '@/server/session'
import { leerPuertaDeEntrada } from '@/server/setters/avisos'
import { armarColaDelSetter } from '@/server/setters/cola'

import { Cola } from './cola'

export const metadata: Metadata = { title: 'Hoy · Setters' }
export const dynamic = 'force-dynamic'

export default async function PaginaHoy() {
  const sesion = await requerirSetter()

  const [puerta, cola] = await Promise.all([
    leerPuertaDeEntrada(sesion.setterId),
    armarColaDelSetter(sesion.setterId),
  ])

  if (cola.cupo.cuentas.length === 0) {
    return (
      <Panel className="px-4 py-8 text-center">
        <h1 className="text-[17px]">Todavía no tenés cuentas cargadas</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-texto-2">
          El administrador tiene que cargar tus cuentas de Instagram antes de que puedas empezar.
          Avisale y volvé a entrar.
        </p>
      </Panel>
    )
  }

  return <Cola cola={cola} puerta={puerta} clavePublica={clavePublica()} />
}

import { MessagesSquare } from 'lucide-react'
import type { Metadata } from 'next'

import { EmptyState } from '@/components/ui/empty-state'
import { Panel } from '@/components/ui/panel'
import { LIMITE_LISTADO, listarContactos, opcionesDeFiltro } from '@/server/contacts'

import { TablaContactos } from '../tabla'

export const metadata: Metadata = { title: 'Hablados · 101leads' }
export const dynamic = 'force-dynamic'

/**
 * Todos los negocios a los que les escribimos alguna vez, con el botón para
 * descargarlos.
 *
 * Es una pregunta que antes no tenía pantalla: "Mis leads" solo muestra los
 * que están asignados a un setter y de una vista a la vez, y Contactos los
 * mezcla con los que nunca tocamos. Acá entra el que recibió un mensaje,
 * venga del carril de setters o del Despachador, **incluidos los que después
 * dimos de baja**: que lo haya descartado no borra que le hablé.
 */
export default async function PaginaHablados() {
  const [hablados, opciones] = await Promise.all([
    listarContactos({ contactados: 'si' }),
    opcionesDeFiltro(),
  ])

  if (hablados.length === 0) {
    return (
      <div className="space-y-3">
        <Encabezado cuantos={0} />
        <Panel>
          <EmptyState
            icono={MessagesSquare}
            titulo="Todavía no le hablamos a nadie"
            detalle="Acá van a aparecer los negocios que reciban un mensaje, por Instagram o por WhatsApp, y vas a poder descargar la lista completa."
            accion={{ texto: 'Ver los contactos', href: '/contactos' }}
          />
        </Panel>
      </div>
    )
  }

  const deBaja = hablados.filter((c) => c.discardedAt).length
  const contestaron = hablados.filter((c) => c.receivedCount > 0).length

  return (
    <div className="space-y-3">
      <Encabezado cuantos={hablados.length} contestaron={contestaron} deBaja={deBaja} />
      <TablaContactos
        contactos={hablados}
        opciones={opciones}
        truncado={hablados.length >= LIMITE_LISTADO}
        contexto="hablados"
      />
    </div>
  )
}

function Encabezado({
  cuantos,
  contestaron = 0,
  deBaja = 0,
}: {
  cuantos: number
  contestaron?: number
  deBaja?: number
}) {
  return (
    <div>
      <h1 className="text-[20px]">Hablados</h1>
      <p className="mt-0.5 text-[12.5px] text-texto-2">
        {cuantos === 0 ? (
          'Los negocios a los que les escribimos alguna vez.'
        ) : (
          <>
            {cuantos.toLocaleString('es-AR')} negocios recibieron un mensaje alguna vez.{' '}
            {contestaron.toLocaleString('es-AR')} contestaron
            {deBaja > 0 ? `, ${deBaja.toLocaleString('es-AR')} están dados de baja` : ''}. Con el
            botón Descargar se los llevás en una planilla.
          </>
        )}
      </p>
    </div>
  )
}

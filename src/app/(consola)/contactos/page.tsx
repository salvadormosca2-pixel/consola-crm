import { Users } from 'lucide-react'
import type { Metadata } from 'next'

import { EmptyState } from '@/components/ui/empty-state'
import { Panel } from '@/components/ui/panel'
import { STAGE_META, type ContactStage } from '@/db/enums'
import { contarPorEtapa, listarContactos, opcionesDeFiltro } from '@/server/contacts'

import { TablaContactos } from './tabla'

export const metadata: Metadata = { title: 'Contactos · Ecosystem' }
export const dynamic = 'force-dynamic'

export default async function PaginaContactos() {
  const [contactos, opciones, porEtapa] = await Promise.all([
    listarContactos(),
    opcionesDeFiltro(),
    contarPorEtapa(),
  ])

  if (contactos.length === 0) {
    return (
      <div className="space-y-3">
        <div>
          <h1 className="text-[20px]">Contactos</h1>
          <p className="mt-0.5 text-[12.5px] text-texto-2">
            Un contacto es un negocio, con los canales que tenga.
          </p>
        </div>
        <Panel>
          <EmptyState
            icono={Users}
            titulo="Todavía no hay contactos"
            detalle={
              <>
                El primer dato entra por el importador de Excel. Subí tu lista con nombre, negocio,
                teléfono e Instagram y se cargan todos de una.
              </>
            }
            accion={{ texto: 'Importar un Excel', href: '/importar' }}
          />
        </Panel>
      </div>
    )
  }

  // Etapas con al menos un contacto, en el orden del embudo.
  const conGente = (Object.keys(STAGE_META) as ContactStage[])
    .map((s) => ({ etapa: s, n: porEtapa[s] ?? 0 }))
    .filter((x) => x.n > 0)

  return (
    <div className="space-y-3">

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[20px]">Contactos</h1>
          <p className="mt-0.5 text-[12.5px] text-texto-2">
            {contactos.length.toLocaleString('es-AR')} negocios en tu base.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {conGente.map(({ etapa, n }) => (
            <span
              key={etapa}
              className="flex items-center gap-1 rounded-[4px] border border-borde bg-superficie px-1.5 py-0.5"
              title={`${n} en ${STAGE_META[etapa].label}`}
            >
              <span
                className={
                  'block h-1.5 w-1.5 rounded-full ' +
                  (STAGE_META[etapa].tone === 'positivo'
                    ? 'bg-verde'
                    : STAGE_META[etapa].tone === 'negativo'
                      ? 'bg-rojo'
                      : STAGE_META[etapa].tone === 'activo'
                        ? 'bg-ambar'
                        : 'bg-texto-2')
                }
              />
              <span className="text-[11px] text-texto-2">{STAGE_META[etapa].label}</span>
              <span className="dato text-[11px] text-texto">{n}</span>
            </span>
          ))}
        </div>
      </div>

      <TablaContactos contactos={contactos} opciones={opciones} />
    </div>
  )
}

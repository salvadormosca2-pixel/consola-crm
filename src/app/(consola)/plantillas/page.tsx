import { FileText } from 'lucide-react'
import type { Metadata } from 'next'

import { EmptyState } from '@/components/ui/empty-state'
import { Panel } from '@/components/ui/panel'

export const metadata: Metadata = { title: 'Plantillas · Consola' }

export default function PaginaPlantillas() {
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[20px]">Plantillas</h1>
        <p className="mt-0.5 text-[12.5px] text-texto-2">
          Los mensajes con variables que se personalizan por contacto.
        </p>
      </div>

      <Panel>
        <EmptyState
          icono={FileText}
          titulo="Las plantillas llegan en la fase 4"
          detalle={
            <>
              Editor con variables, vista previa contra un contacto real de tu base, variantes
              rotativas y plantillas por rubro. Necesita contactos cargados para poder previsualizar.
            </>
          }
          accion={{ texto: 'Importar un Excel', href: '/importar' }}
        />
      </Panel>
    </div>
  )
}

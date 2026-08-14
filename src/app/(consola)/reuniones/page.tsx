import { CalendarDays } from 'lucide-react'
import type { Metadata } from 'next'

import { EmptyState } from '@/components/ui/empty-state'
import { Panel } from '@/components/ui/panel'

export const metadata: Metadata = { title: 'Reuniones · Consola' }

export default function PaginaReuniones() {
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[20px]">Reuniones</h1>
        <p className="mt-0.5 text-[12.5px] text-texto-2">
          Las llamadas y visitas agendadas con los que respondieron.
        </p>
      </div>

      <Panel>
        <EmptyState
          icono={CalendarDays}
          titulo="El calendario llega con la parte 2"
          detalle={
            <>
              La tabla de reuniones ya está en la base y guarda tipo, estado y resultado de cada una.
              La vista de agenda y los recordatorios se construyen junto con el motor de envío.
            </>
          }
        />
      </Panel>
    </div>
  )
}

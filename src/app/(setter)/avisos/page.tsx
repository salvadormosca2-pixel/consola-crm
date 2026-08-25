import type { Metadata } from 'next'

import { Panel } from '@/components/ui/panel'
import { requerirSetter } from '@/server/session'
import { listarAvisos, listarRecordatorios } from '@/server/setters/avisos'

import { Historial } from './historial'

export const metadata: Metadata = { title: 'Avisos · Setters' }
export const dynamic = 'force-dynamic'

export default async function PaginaAvisos() {
  const sesion = await requerirSetter()

  const [avisos, recordatorios] = await Promise.all([
    listarAvisos(sesion.setterId),
    listarRecordatorios(sesion.setterId),
  ])

  if (avisos.length === 0 && recordatorios.length === 0) {
    return (
      <Panel className="px-4 py-10 text-center">
        <h1 className="text-[16px]">No hay avisos</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-texto-2">
          Acá van a aparecer los mensajes del equipo: cambios de guion, horarios y recordatorios.
        </p>
      </Panel>
    )
  }

  return <Historial avisos={avisos} recordatorios={recordatorios} />
}

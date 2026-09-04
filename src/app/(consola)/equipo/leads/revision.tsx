'use client'

import { Wrench } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { repararLeads } from '@/server/actions/equipo'
import type { RevisionDeLeads } from '@/server/setters/revision'

/**
 * Los leads que no aparecen en ninguna pantalla.
 *
 * Solo se muestra si hay alguno. Un cartel permanente diciendo "cero
 * problemas" es ruido que después nadie lee el día que dice otra cosa.
 */
export function Revision({ revision }: { revision: RevisionDeLeads }) {
  const router = useRouter()
  const [pendiente, iniciar] = React.useTransition()

  if (revision.parados === 0) return null

  function reparar(): void {
    iniciar(async () => {
      const r = await repararLeads()
      if (r.ok) {
        toast.success(
          r.reparados === 1
            ? '1 lead volvió a su escalera'
            : `${r.reparados} leads volvieron a su escalera`,
        )
        router.refresh()
      } else {
        toast.error(r.error ?? 'No se pudieron reparar.')
      }
    })
  }

  return (
    <Panel className="border-ambar/40">
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-ambar" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-texto">
            {revision.parados} {revision.parados === 1 ? 'lead quedó' : 'leads quedaron'} sin
            próximo paso
          </p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-texto-2">
            Recibieron un mensaje y no esperan nada: no están en la cola de ningún setter, ni en
            el pozo, ni en la de clasificación. Se cortó la cadena a mitad de camino y por eso no
            aparecen en ninguna pantalla. Repararlos los devuelve al escalón que les toca,
            contado desde su último mensaje: los viejos salen enseguida.
          </p>
          <Button variant="secundaria" className="mt-2" disabled={pendiente} onClick={reparar}>
            <Wrench aria-hidden />
            {pendiente ? 'Reparando…' : `Reparar ${revision.parados}`}
          </Button>
        </div>
      </div>
    </Panel>
  )
}

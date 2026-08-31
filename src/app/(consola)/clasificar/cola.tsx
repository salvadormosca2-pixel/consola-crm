'use client'

import { Clock, Inbox } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Chip, Panel, PanelHeader } from '@/components/ui/panel'
import { DESTINOS_DE_CLASIFICACION, DESTINO_META, type DestinoDeClasificacion } from '@/lib/setters-config'
import { formatCorto } from '@/lib/tz'
import { cn } from '@/lib/utils'
import { clasificarLead } from '@/server/actions/clasificacion'
import type { ColaDeClasificacion, LeadSinClasificar } from '@/server/setters/clasificacion'

/**
 * Los leads que contestaron la oferta y esperan que alguien decida por dónde
 * siguen.
 *
 * Están ordenados por antigüedad y no por nada más: el que más espera es el que
 * más se enfría, y es alguien que ya habló. El rojo aparece cuando pasó el SLA
 * en horas hábiles — no de reloj, porque un lead que contestó a las once de la
 * noche no está atrasado a las tres de la mañana y llenar la pantalla de rojo
 * todas las madrugadas haría que el rojo deje de significar algo.
 */

const TONO: Record<DestinoDeClasificacion, 'positiva' | 'secundaria' | 'destructiva'> = {
  interesado: 'positiva',
  tibio: 'secundaria',
  silencio: 'secundaria',
  no_interesa: 'destructiva',
}

export function Cola({ cola }: { cola: ColaDeClasificacion }) {
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[22px]">Clasificar</h1>
        <p className="mt-1 max-w-[760px] text-[13px] leading-relaxed text-texto-2">
          Contestaron la oferta y están esperando que alguien decida por dónde siguen. Es la espera
          más cara que hay: no son desconocidos, ya hablaron. Se cuentan{' '}
          <strong className="font-medium text-texto">{cola.sla} horas hábiles</strong> desde que
          contestaron; pasadas esas, va en rojo.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Chip>{cola.leads.length} esperando</Chip>
        {cola.atrasados > 0 ? (
          <Chip tono="negativo">{cola.atrasados} pasaron las {cola.sla} h</Chip>
        ) : (
          <Chip tono="positivo">Ninguno atrasado</Chip>
        )}
      </div>

      {cola.leads.length === 0 ? (
        <EmptyState
          icono={Inbox}
          titulo="No hay nadie esperando"
          detalle="Cuando un lead conteste la oferta, aparece acá para decidir por dónde sigue."
        />
      ) : (
        cola.leads.map((lead) => <Ficha key={lead.assignmentId} lead={lead} sla={cola.sla} />)
      )}
    </div>
  )
}

function Ficha({ lead, sla }: { lead: LeadSinClasificar; sla: number }) {
  const router = useRouter()
  const [pendiente, iniciar] = React.useTransition()

  function clasificar(destino: DestinoDeClasificacion): void {
    iniciar(async () => {
      const r = await clasificarLead({ assignmentId: lead.assignmentId, destino })
      if (r.ok) {
        toast.success(`${lead.negocio}: ${DESTINO_META[destino].label.toLowerCase()}`)
        router.refresh()
      } else toast.error(r.error ?? 'No se pudo clasificar.')
    })
  }

  return (
    <Panel className={lead.atrasado ? 'border-rojo/40' : undefined}>
      <PanelHeader
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            {lead.negocio}
            <span className="dato text-[12px] font-normal text-texto-2">@{lead.igUsername}</span>
            {lead.rubro ? <Chip>{lead.rubro}</Chip> : null}
          </span>
        }
        descripcion={`Lo trabaja ${lead.setterNombre} · contestó el ${formatCorto(lead.respondidoAt)}`}
        acciones={
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-[5px] border px-2 py-1 text-[11.5px]',
              lead.atrasado
                ? 'border-rojo/40 bg-rojo-tenue text-rojo'
                : 'border-borde bg-elevada text-texto-2',
            )}
          >
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {formatEspera(lead.horasEsperando)}
            {lead.atrasado ? ` · pasó las ${sla} h` : null}
          </span>
        }
      />

      {/* El hilo primero. La nota dice lo que el setter entendió; el hilo dice
          lo que el lead escribió, y es lo que decide la pista. */}
      {lead.hilo.length > 0 ? (
        <div className="space-y-1.5 border-b border-borde px-3 py-3">
          {lead.hilo.map((m, i) => (
            <div
              key={i}
              className={cn(
                'max-w-[80%] rounded-[8px] px-2.5 py-1.5 text-[12.5px] leading-relaxed',
                m.entrante
                  ? 'bg-elevada text-texto'
                  : 'ml-auto bg-acento-tenue text-texto',
              )}
            >
              <p className="whitespace-pre-wrap">{m.texto}</p>
              <span className="dato mt-0.5 block text-[10.5px] text-texto-2">
                {m.entrante ? 'Él' : 'Nosotros'} · {formatCorto(m.cuando)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {lead.nota ? (
        <div className="border-b border-borde px-3 py-2">
          <div className="rotulo mb-0.5">Lo que anotó el setter</div>
          <p className="text-[12.5px] leading-relaxed text-texto">{lead.nota}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5 px-3 py-3">
        {DESTINOS_DE_CLASIFICACION.map((d) => (
          <Button
            key={d}
            variant={TONO[d]}
            size="sm"
            disabled={pendiente}
            title={DESTINO_META[d].detalle}
            onClick={() => clasificar(d)}
          >
            {DESTINO_META[d].label}
          </Button>
        ))}
      </div>
    </Panel>
  )
}

function formatEspera(horas: number): string {
  if (horas < 1) return `${Math.round(horas * 60)} min hábiles`
  return `${horas.toFixed(1).replace('.0', '')} h hábiles`
}

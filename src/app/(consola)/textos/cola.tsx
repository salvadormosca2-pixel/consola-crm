'use client'

import { PencilLine } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Chip, Panel, PanelHeader } from '@/components/ui/panel'
import { formatCorto } from '@/lib/tz'
import { cn } from '@/lib/utils'
import { guardarTexto } from '@/server/actions/textos'
import type { ColaDeTextos, LeadEsperandoTexto } from '@/server/setters/textos'

/**
 * Escribir el mensaje de cada lead, uno por uno.
 *
 * Las dos listas están separadas porque son dos trabajos distintos: el primer
 * mensaje se escribe mirando el perfil de un desconocido, y el seguimiento se
 * escribe mirando lo que esa persona ya contestó. Por eso el hilo va arriba
 * del campo y no escondido en un desplegable.
 */
export function Cola({ cola }: { cola: ColaDeTextos }) {
  const total = cola.primerMensaje.length + cola.seguimiento.length

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px]">Textos</h1>
        <p className="mt-1 max-w-[760px] text-[13px] leading-relaxed text-texto-2">
          El mensaje de cada lead, escrito a mano. No hay plantillas: lo que escribas acá es
          exactamente lo que el setter copia y pega. Mientras un lead no tenga su texto, en el
          celular aparece bloqueado y no se puede mandar nada.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {cola.sinEscribir > 0 ? (
          <Chip tono="negativo">{cola.sinEscribir} sin escribir</Chip>
        ) : (
          <Chip tono="positivo">No falta ninguno</Chip>
        )}
        <Chip>{total} en total</Chip>
      </div>

      <Seccion
        titulo="Primer mensaje"
        detalle="Nunca recibieron nada. Es lo único que gasta cupo, así que es lo que más conviene escribir bien."
        leads={cola.primerMensaje}
        vacio="No hay leads esperando el primer mensaje."
      />

      <Seccion
        titulo="Seguimiento"
        detalle="Leads calificados a los que les toca el escalón siguiente. Se escribe con lo que contestaron a la vista."
        leads={cola.seguimiento}
        vacio="No hay seguimientos para escribir."
      />
    </div>
  )
}

function Seccion({
  titulo,
  detalle,
  leads,
  vacio,
}: {
  titulo: string
  detalle: string
  leads: LeadEsperandoTexto[]
  vacio: string
}) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-[16px]">
          {titulo} <span className="dato text-[13px] text-texto-2">{leads.length}</span>
        </h2>
        <p className="mt-0.5 max-w-[760px] text-[12.5px] leading-relaxed text-texto-2">{detalle}</p>
      </div>

      {leads.length === 0 ? (
        <EmptyState icono={PencilLine} titulo={vacio} detalle="" />
      ) : (
        leads.map((lead) => <Ficha key={`${lead.assignmentId}-${lead.paso}`} lead={lead} />)
      )}
    </section>
  )
}

function Ficha({ lead }: { lead: LeadEsperandoTexto }) {
  const router = useRouter()
  const [texto, setTexto] = React.useState(lead.body ?? '')
  const [pendiente, iniciar] = React.useTransition()

  const sinEscribir = lead.body === null
  const cambiado = texto.trim() !== (lead.body ?? '').trim()

  function guardar(): void {
    iniciar(async () => {
      const r = await guardarTexto({
        assignmentId: lead.assignmentId,
        paso: lead.paso,
        body: texto,
      })
      if (r.ok) {
        toast.success(`Listo: ${lead.negocio} ya tiene su mensaje.`)
        router.refresh()
      } else toast.error(r.error ?? 'No se pudo guardar.')
    })
  }

  return (
    <Panel className={sinEscribir ? 'border-rojo/40' : undefined}>
      <PanelHeader
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            {lead.negocio}
            <span className="dato text-[12px] font-normal text-texto-2">@{lead.igUsername}</span>
            {lead.rubro ? <Chip>{lead.rubro}</Chip> : null}
            {lead.ciudad ? <Chip>{lead.ciudad}</Chip> : null}
          </span>
        }
        descripcion={`${lead.pasoLabel} · lo trabaja ${lead.setterNombre}${
          lead.cuando ? ` · ${formatCorto(lead.cuando)}` : ''
        }`}
        acciones={
          sinEscribir ? <Chip tono="negativo">Falta</Chip> : <Chip tono="positivo">Escrito</Chip>
        }
      />

      {lead.hilo.length > 0 ? (
        <div className="space-y-1.5 border-b border-borde px-3 py-3">
          {lead.hilo.map((m, i) => (
            <div
              key={i}
              className={cn(
                'max-w-[80%] rounded-[8px] px-2.5 py-1.5 text-[12.5px] leading-relaxed',
                m.entrante ? 'bg-elevada text-texto' : 'ml-auto bg-acento-tenue text-texto',
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

      <div className="space-y-2 px-3 py-3">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder={
            lead.nombreDePersona
              ? `Escribile a ${lead.nombreDePersona}…`
              : `Escribile a ${lead.negocio}…`
          }
          className="w-full resize-y rounded-[6px] border border-borde bg-fondo px-3 py-2 text-[13px] leading-relaxed text-texto outline-none placeholder:text-texto-2 focus:border-acento"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="dato text-[11.5px] text-texto-2">{texto.trim().length} caracteres</span>
          <Button
            size="sm"
            disabled={pendiente || !cambiado || texto.trim().length === 0}
            onClick={guardar}
          >
            {sinEscribir ? 'Guardar' : 'Guardar cambios'}
          </Button>
        </div>
      </div>
    </Panel>
  )
}

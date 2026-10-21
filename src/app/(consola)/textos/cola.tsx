'use client'

import { ExternalLink, PencilLine } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { AbrirInstagram } from '@/components/setter/abrir-instagram'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Chip, Panel, PanelHeader } from '@/components/ui/panel'
import { formatCorto } from '@/lib/tz'
import { cn } from '@/lib/utils'
import { guardarTexto, guardarTextoGeneral } from '@/server/actions/textos'
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
          Hay dos niveles y el de arriba gana: el mensaje que escribís para{' '}
          <strong className="font-medium text-texto">ese</strong> lead, y si no tiene, el{' '}
          <strong className="font-medium text-texto">general</strong> del paso. Lo que salga es
          exactamente lo que el setter copia y pega.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {cola.bloqueados > 0 ? (
          <Chip tono="negativo">{cola.bloqueados} bloqueados</Chip>
        ) : (
          <Chip tono="positivo">Ninguno bloqueado</Chip>
        )}
        <Chip>{cola.sinEscribir} sin texto propio</Chip>
        <Chip>{total} en total</Chip>
      </div>

      <Generales generales={cola.generales} />

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

/**
 * Los mensajes generales, uno por paso.
 *
 * Es lo primero de la pantalla porque es lo que destraba todo: con el de
 * entrada escrito, el equipo puede mandar desde el minuto cero y los textos
 * propios pasan a ser lo que son — una mejora para el lead que vale la pena,
 * no un peaje para los mil que entraron hoy.
 *
 * Son texto plano, sin variables. El mismo para todos: el que quiera nombrar
 * al negocio se escribe lead por lead, abajo.
 */
function Generales({ generales }: { generales: ColaDeTextos['generales'] }) {
  return (
    <Panel>
      <PanelHeader
        titulo="Mensajes generales"
        descripcion="El que sale cuando el lead no tiene uno propio. Si lo dejás vacío, ese paso exige escribirle a cada lead."
      />
      <div className="divide-y divide-borde">
        {generales.map((g) => (
          <General key={g.paso} general={g} />
        ))}
      </div>
    </Panel>
  )
}

function General({ general }: { general: ColaDeTextos['generales'][number] }) {
  const router = useRouter()
  const [texto, setTexto] = React.useState(general.body ?? '')
  const [pendiente, iniciar] = React.useTransition()

  const cambiado = texto.trim() !== (general.body ?? '').trim()

  function guardar(): void {
    iniciar(async () => {
      const r = await guardarTextoGeneral({ paso: general.paso, body: texto })
      if (r.ok) {
        toast.success(
          texto.trim().length > 0
            ? `Listo: "${general.label}" ya tiene su mensaje general.`
            : `"${general.label}" vuelve a exigir un texto por lead.`,
        )
        router.refresh()
      } else toast.error(r.error ?? 'No se pudo guardar.')
    })
  }

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13.5px] text-texto">{general.label}</span>
        {general.body ? (
          <Chip tono="positivo">escrito</Chip>
        ) : (
          <Chip tono="negativo">sin escribir</Chip>
        )}
      </div>
      <p className="mt-0.5 text-[12px] leading-relaxed text-texto-2">{general.cuando}</p>

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder={
          general.paso === 1
            ? 'Ej: Hola! Vi tu perfil, quería hacerte una consulta. ¿Estás?'
            : 'Dejalo vacío si este paso lo querés escribir lead por lead.'
        }
        className="mt-2 w-full resize-y rounded-[6px] border border-borde bg-fondo px-3 py-2 text-[13px] leading-relaxed text-texto outline-none placeholder:text-texto-2 focus:border-acento"
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="dato text-[11.5px] text-texto-2">{texto.trim().length} caracteres</span>
        <Button size="sm" disabled={pendiente || !cambiado} onClick={guardar}>
          Guardar
        </Button>
      </div>
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
  const bloqueado = sinEscribir && lead.general === null
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
    <Panel className={bloqueado ? 'border-rojo/40' : undefined}>
      <PanelHeader
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            {lead.negocio}
            {/* El usuario abre el perfil, que es con lo que se escribe el
                primer mensaje: antes era texto suelto y había que buscarlo a
                mano en Instagram. */}
            <AbrirInstagram
              link={`https://www.instagram.com/${lead.igUsername}/`}
              aria-label={`Abrir @${lead.igUsername} en Instagram`}
              className="dato inline-flex items-center gap-1 text-[12px] font-normal text-texto-2 hover:text-texto hover:underline"
            >
              @{lead.igUsername}
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </AbrirInstagram>
            {lead.rubro ? <Chip>{lead.rubro}</Chip> : null}
            {lead.ciudad ? <Chip>{lead.ciudad}</Chip> : null}
          </span>
        }
        descripcion={`${lead.pasoLabel} · lo trabaja ${lead.setterNombre}${
          lead.cuando ? ` · ${formatCorto(lead.cuando)}` : ''
        }`}
        acciones={
          bloqueado ? (
            <Chip tono="negativo">Bloqueado</Chip>
          ) : sinEscribir ? (
            <Chip>Sale el general</Chip>
          ) : (
            <Chip tono="positivo">Propio</Chip>
          )
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
        {/* Qué va a pasar si se deja vacío. Sin esto no se sabe si el campo en
            blanco significa "no sale nada" o "sale el de siempre". */}
        {sinEscribir ? (
          <p className="text-[11.5px] leading-relaxed text-texto-2">
            {lead.general === null
              ? 'Sin texto propio y sin general: este lead está bloqueado en el celular.'
              : `Si lo dejás vacío sale el general: "${lead.general}"`}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <span className="dato text-[11.5px] text-texto-2">{texto.trim().length} caracteres</span>
          <Button
            size="sm"
            disabled={pendiente || !cambiado || texto.trim().length === 0}
            onClick={guardar}
          >
            {sinEscribir ? 'Escribirle uno propio' : 'Guardar cambios'}
          </Button>
        </div>
      </div>
    </Panel>
  )
}

'use client'

import { CalendarPlus, Star, Trash2, X } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { agendarReunion, calificarLead, descartarLead } from '@/server/actions/setter'
import { cn } from '@/lib/utils'

/**
 * **Un solo botón por lead**, el que corresponde a su etapa.
 *
 * Son dos y nada más: calificar al que contestó, y agendarle la reunión al que
 * ya está calificado. Antes eran cuatro —contestó el primero, mandar la
 * oferta, contestó la oferta con un sí/tibio/no, agendó— y servían para elegir
 * cuál de las plantillas salía. Sin plantillas no hay nada que elegir: el
 * texto lo escribe el admin mirando el lead, y lo único que el sistema
 * necesita saber es si el lead sigue en juego.
 */

export type EtapaDelLead = 'sin_contactar' | 'contactado' | 'calificado'

export interface AccionDisponible {
  tipo: 'calificar' | 'reunion'
  label: string
}

/**
 * Qué se puede hacer con un lead según dónde está.
 *
 * Los que están sin contactar no tienen acción acá: se trabajan en la cola del
 * día, que es donde arranca todo.
 */
export function accionDe(etapa: EtapaDelLead): AccionDisponible | null {
  switch (etapa) {
    case 'contactado':
      return { tipo: 'calificar', label: 'Calificar: contestó y sirve' }
    case 'calificado':
      return { tipo: 'reunion', label: 'Agendó reunión' }
    default:
      return null
  }
}

/**
 * Dónde está el lead, mirando su estado.
 *
 * Los dos estados del modelo viejo —"respondió" y "segundo enviado"— caen en
 * contactado: son leads que contestaron algo y a los que todavía nadie
 * calificó, que es exactamente lo que hay que decidir sobre ellos.
 */
export function etapaDe(f: { estado: string }): EtapaDelLead {
  if (f.estado === 'calificado') return 'calificado'
  if (['contactado', 'segundo_enviado', 'respondido'].includes(f.estado)) return 'contactado'
  return 'sin_contactar'
}

/* ── La hoja que sube desde abajo ─────────────────────────────────────── */

function Hoja({
  titulo,
  onCerrar,
  children,
}: {
  titulo: string
  onCerrar: () => void
  children: React.ReactNode
}) {
  React.useEffect(() => {
    function alTeclado(e: KeyboardEvent): void {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', alTeclado)
    return () => window.removeEventListener('keydown', alTeclado)
  }, [onCerrar])

  return (
    <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true">
      <button
        className="absolute inset-0 bg-black/70"
        aria-label="Cerrar"
        onClick={onCerrar}
        tabIndex={-1}
      />
      <div className="relative w-full rounded-t-[14px] border-t border-borde bg-superficie pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-between border-b border-borde px-4 py-3">
          <h2 className="text-[15px] font-semibold">{titulo}</h2>
          <button
            onClick={onCerrar}
            aria-label="Cerrar"
            className="flex h-9 w-9 items-center justify-center rounded-[8px] text-texto-2"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>
  )
}

/** Fecha de hoy en el celular, para precargar el formulario de reunión. */
function hoyLocal(): string {
  const d = new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

export function AccionDeLead({
  assignmentId,
  negocio,
  etapa,
  onHecho,
  className,
}: {
  assignmentId: string
  negocio: string
  etapa: EtapaDelLead
  onHecho?: () => void
  className?: string
}) {
  const accion = accionDe(etapa)

  const [abierta, setAbierta] = React.useState(false)
  const [pendiente, iniciar] = React.useTransition()
  const [nota, setNota] = React.useState('')
  const [fecha, setFecha] = React.useState(hoyLocal)
  const [hora, setHora] = React.useState('10:00')
  const [tipo, setTipo] = React.useState<'llamada' | 'videollamada'>('llamada')

  if (!accion) return null

  function descartar(): void {
    iniciar(async () => {
      const r = await descartarLead(assignmentId)
      if (r.ok) {
        toast.success(`${negocio} queda afuera: no se le escribe más`)
        setAbierta(false)
        onHecho?.()
      } else {
        toast.error(r.error ?? 'No se pudo descartar.')
      }
    })
  }

  function enviarCalificado(): void {
    iniciar(async () => {
      const r = await calificarLead(assignmentId, { nota: nota.trim() || undefined })
      if (r.ok) {
        toast.success(`${negocio} quedó calificado: entra al seguimiento`)
        setAbierta(false)
        setNota('')
        onHecho?.()
      } else {
        toast.error(r.error ?? 'No se pudo calificar.')
      }
    })
  }

  function enviarReunion(): void {
    iniciar(async () => {
      const r = await agendarReunion(assignmentId, {
        fecha,
        hora,
        tipo,
        nota: nota.trim() || undefined,
      })
      if (r.ok) {
        toast.success('Reunión agendada')
        setAbierta(false)
        setNota('')
        onHecho?.()
      } else {
        toast.error(r.error ?? 'No se pudo agendar.')
      }
    })
  }

  return (
    <>
      <Button
        variant={accion.tipo === 'reunion' ? 'secundaria' : 'positiva'}
        className={cn('h-11 w-full text-[14px]', className)}
        onClick={() => setAbierta(true)}
      >
        {accion.tipo === 'reunion' ? <CalendarPlus aria-hidden /> : <Star aria-hidden />}
        {accion.label}
      </Button>

      {abierta && accion.tipo === 'calificar' ? (
        <Hoja titulo={`¿Qué dijo ${negocio}?`} onCerrar={() => setAbierta(false)}>
          {/*
            Calificar es decir "este sigue". Lo que anotes acá es lo que se lee
            después para escribirle el seguimiento, así que conviene que diga
            qué contestó y no "interesado".
          */}
          <p className="text-[13px] leading-relaxed text-texto-2">
            Al calificarlo entra al seguimiento y le va a tocar el próximo mensaje a los días que
            estén configurados. Si no contestó o no sirve, no lo califiques: dejalo o descartalo.
          </p>

          <Field label="Qué dijo (opcional, pero ayuda)" className="mt-4">
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Ej: preguntó cuánto sale y si trabajamos con locales chicos"
              className="w-full resize-y rounded-[6px] border border-borde bg-fondo px-2.5 py-2 text-[16px] leading-relaxed text-texto focus:border-acento focus:outline-none"
            />
          </Field>

          <Button
            variant="positiva"
            className="mt-4 h-12 w-full text-[14px]"
            onClick={enviarCalificado}
            disabled={pendiente}
          >
            <Star aria-hidden />
            {pendiente ? 'Guardando…' : 'Calificar'}
          </Button>

          {/*
            La otra mitad de la decisión. Sin esto, el que contestó "no" se
            queda contactado para siempre y nadie lo saca de la lista.
          */}
          <Button
            variant="destructiva"
            className="mt-2 h-12 w-full text-[14px]"
            onClick={descartar}
            disabled={pendiente}
          >
            <Trash2 aria-hidden />
            Descartar: no sirve
          </Button>
        </Hoja>
      ) : null}

      {abierta && accion.tipo === 'reunion' ? (
        <Hoja titulo={`Reunión con ${negocio}`} onCerrar={() => setAbierta(false)}>
          <div className="flex gap-2">
            <Field label="Fecha" className="flex-1">
              <Input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="h-11 text-[16px]"
              />
            </Field>
            <Field label="Hora" className="w-[130px]">
              <Input
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                className="h-11 text-[16px]"
              />
            </Field>
          </div>

          <div className="mt-3 flex gap-2">
            {(['llamada', 'videollamada'] as const).map((t) => (
              <Button
                key={t}
                variant={tipo === t ? 'primaria' : 'secundaria'}
                className="h-11 flex-1"
                onClick={() => setTipo(t)}
              >
                {t === 'llamada' ? 'Llamada' : 'Videollamada'}
              </Button>
            ))}
          </div>

          <Field label="Nota (opcional)" className="mt-3">
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={2}
              className="w-full resize-y rounded-[6px] border border-borde bg-fondo px-2.5 py-2 text-[16px] leading-relaxed text-texto focus:border-acento focus:outline-none"
            />
          </Field>

          <Button
            variant="primaria"
            className="mt-4 h-12 w-full"
            onClick={enviarReunion}
            disabled={pendiente}
          >
            {pendiente ? 'Guardando…' : 'Agendar'}
          </Button>
        </Hoja>
      ) : null}
    </>
  )
}

'use client'

import {
  CalendarPlus,
  Check,
  ExternalLink,
  MessageSquareReply,
  Send,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import {
  abrirChat,
  agendarReunion,
  marcarEnviado,
  marcarRespondio,
  verMensajePreparado,
  type MensajeListo,
} from '@/server/actions/setter'
import { abrirEnInstagram } from '@/lib/abrir-instagram'
import { copiarAlPortapapeles } from '@/lib/copiar'
import { cn } from '@/lib/utils'

/**
 * **Un solo botón por lead**, el que corresponde a su etapa.
 *
 * Antes cada fila mostraba "Respondió" y "Agendó reunión" a la vez, en todas
 * las pestañas, y no se entendía cuál tocar. Ahora el botón dice exactamente
 * qué pasó —"Contestó el 1er mensaje", "Contestó la oferta", "Agendó
 * reunión"— y al tocarlo el lead se mueve a la pestaña siguiente.
 */

export type EtapaDelLead =
  | 'sin_contactar'
  | 'contactado'
  | 'respondio_primero'
  | 'oferta_enviada'
  | 'respondio_oferta'

export interface AccionDisponible {
  tipo: 'respondio' | 'oferta' | 'reunion'
  label: string
  /** El lead ya vio la oferta: la respuesta es un sí o un no. */
  conInteres: boolean
}

/**
 * Qué se puede hacer con un lead según dónde está.
 *
 * Es una acción por etapa y siempre la misma: la que de verdad sigue. El que
 * contestó la entrada todavía no sabe a qué nos dedicamos, así que lo que
 * sigue es **mandarle la oferta**, no agendarle nada. Recién cuando contesta
 * la oferta tiene sentido el botón de reunión.
 *
 * Los que están sin contactar no tienen acción acá: se trabajan en la cola del
 * día, que es donde arranca todo.
 */
export function accionDe(etapa: EtapaDelLead): AccionDisponible | null {
  switch (etapa) {
    case 'contactado':
      return { tipo: 'respondio', label: 'Contestó el 1er mensaje', conInteres: false }
    case 'respondio_primero':
      return { tipo: 'oferta', label: 'Enviar la oferta', conInteres: false }
    case 'oferta_enviada':
      return { tipo: 'respondio', label: 'Contestó la oferta', conInteres: true }
    case 'respondio_oferta':
      return { tipo: 'reunion', label: 'Agendó reunión', conInteres: false }
    default:
      return null
  }
}

/**
 * Dónde está el lead, mirando su estado.
 *
 * El orden importa y es el del recorrido, del final hacia atrás: alguien que
 * contestó la entrada y **ya recibió la oferta** está en "Le mandé la oferta",
 * no en "Respondió el 1er mensaje". Si no, quedaría con el botón de mandar una
 * oferta que ya salió.
 */
export function etapaDe(f: {
  estado: string
  respondioA: string | null
}): EtapaDelLead {
  if (f.respondioA === 'segundo') return 'respondio_oferta'
  if (f.estado === 'segundo_enviado') return 'oferta_enviada'
  if (f.respondioA === 'primero') return 'respondio_primero'
  if (f.estado === 'contactado') return 'contactado'
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

/* ── Mandar la oferta sin pasar por la cola ───────────────────────────── */

/**
 * El lead acaba de contestar y hay que contestarle ya. Esto es la cola del día
 * en chico: el mensaje que escribió el admin para su rubro, copiar, abrir el
 * chat, y confirmar que salió.
 *
 * El botón de confirmar no se habilita hasta haber abierto el chat, igual que
 * en la cola: es lo que evita el marcado accidental y lo que hace que el cupo
 * se consuma solo cuando el mensaje realmente salió.
 */
function HojaDeOferta({
  assignmentId,
  negocio,
  onCerrar,
  onHecho,
}: {
  assignmentId: string
  negocio: string
  onCerrar: () => void
  onHecho?: () => void
}) {
  const [mensaje, setMensaje] = React.useState<MensajeListo | null>(null)
  const [abierto, setAbierto] = React.useState(false)
  const [pendiente, iniciar] = React.useTransition()

  React.useEffect(() => {
    let vigente = true
    void verMensajePreparado(assignmentId).then((r) => {
      if (vigente) setMensaje(r)
    })
    return () => {
      vigente = false
    }
  }, [assignmentId])

  function abrirInstagram(): void {
    if (!mensaje?.texto || !mensaje.linkDirecto) return
    /*
     * Se copia ANTES de abrir: una vez que el navegador cambia de app ya no se
     * puede escribir en el portapapeles. Y el copiado no puede impedir la
     * apertura: sin HTTPS la API del portapapeles no existe, y la excepción se
     * llevaba puesta la línea de abajo.
     */
    void copiarAlPortapapeles(mensaje.texto).then((ok) => {
      if (ok) toast.success('Mensaje copiado — pegá con mantener presionado')
      else toast.error('No se pudo copiar. Copiá el texto a mano.')
    })
    abrirEnInstagram(mensaje.linkDirecto)
    setAbierto(true)
    void abrirChat(assignmentId)
  }

  function confirmar(): void {
    iniciar(async () => {
      const r = await marcarEnviado(assignmentId)
      if (r.ok) {
        if (!r.duplicado) toast.success(`Oferta enviada · ${r.usadoHoy}/${r.cupo} con esta cuenta`)
        onCerrar()
        onHecho?.()
      } else {
        toast.error(r.error ?? 'No se pudo registrar el envío.')
      }
    })
  }

  return (
    <Hoja titulo={`La oferta para ${negocio}`} onCerrar={onCerrar}>
      {mensaje === null ? (
        <p className="py-6 text-center text-[13px] text-texto-2">Armando el mensaje…</p>
      ) : !mensaje.ok ? (
        <div className="rounded-[6px] border border-rojo/35 bg-rojo-tenue px-3 py-2.5">
          <p className="text-[13px] font-medium text-rojo">No se puede armar el mensaje</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-texto-2">
            {mensaje.error} Avisale al administrador.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-[6px] border border-borde bg-fondo px-2.5 py-2">
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-texto">
              {mensaje.texto}
            </p>
          </div>

          <Button
            variant={abierto ? 'secundaria' : 'primaria'}
            className="mt-3 h-12 w-full text-[14px]"
            onClick={abrirInstagram}
          >
            <ExternalLink aria-hidden />
            Abrir Instagram
          </Button>

          <Button
            variant="positiva"
            className="mt-2 h-12 w-full text-[14px]"
            onClick={confirmar}
            disabled={pendiente || !abierto}
          >
            <Check aria-hidden />
            {pendiente ? 'Guardando…' : 'Enviado'}
          </Button>

          {!abierto ? (
            <p className="mt-2 text-center text-[11.5px] text-texto-2">
              Se habilita cuando abrís el chat.
            </p>
          ) : null}
        </>
      )}
    </Hoja>
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

  function enviarRespondio(interes?: 'interesa' | 'no_interesa'): void {
    iniciar(async () => {
      const r = await marcarRespondio(assignmentId, {
        nota: nota.trim() || undefined,
        interes,
      })
      if (r.ok) {
        toast.success(
          interes === 'no_interesa'
            ? `${negocio}: anotado que no le interesa`
            : `${negocio} pasó a la etapa siguiente`,
        )
        setAbierta(false)
        setNota('')
        onHecho?.()
      } else {
        toast.error(r.error ?? 'No se pudo marcar.')
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
        variant={
          accion.tipo === 'oferta' ? 'primaria' : accion.tipo === 'reunion' ? 'secundaria' : 'positiva'
        }
        className={cn('h-11 w-full text-[14px]', className)}
        onClick={() => setAbierta(true)}
      >
        {accion.tipo === 'oferta' ? (
          <Send aria-hidden />
        ) : accion.tipo === 'reunion' ? (
          <CalendarPlus aria-hidden />
        ) : (
          <MessageSquareReply aria-hidden />
        )}
        {accion.label}
      </Button>

      {abierta && accion.tipo === 'oferta' ? (
        <HojaDeOferta
          assignmentId={assignmentId}
          negocio={negocio}
          onCerrar={() => setAbierta(false)}
          onHecho={onHecho}
        />
      ) : null}

      {abierta && accion.tipo === 'respondio' ? (
        <Hoja
          titulo={accion.conInteres ? `¿Qué dijo ${negocio}?` : `${negocio} contestó`}
          onCerrar={() => setAbierta(false)}
        >
          {accion.conInteres ? (
            /*
             * Acá sí se escribe, y es obligatorio. Ya vio la oferta: lo que
             * dijo es lo que decide cómo sigue —si se le insiste, si se le
             * baja el precio, si se cierra— y es lo único que queda de esa
             * conversación cuando la retoma el equipo.
             */
            <>
              <p className="text-[13px] leading-relaxed text-texto-2">
                Ya recibió la oferta, así que su respuesta es un sí o un no. Anotá qué dijo: sin
                eso no se puede seguir la conversación.
              </p>

              <Field label="Qué dijo" className="mt-4">
                <textarea
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  rows={3}
                  autoFocus
                  placeholder="Ej: le interesa pero quiere arrancar el mes que viene"
                  className="w-full resize-y rounded-[6px] border border-borde bg-fondo px-2.5 py-2 text-[16px] leading-relaxed text-texto focus:border-acento focus:outline-none"
                />
              </Field>

              <div className="mt-4 space-y-2">
                <Button
                  variant="positiva"
                  className="h-12 w-full text-[14px]"
                  onClick={() => enviarRespondio('interesa')}
                  disabled={pendiente || nota.trim().length === 0}
                >
                  <ThumbsUp aria-hidden />
                  Le interesa
                </Button>
                <Button
                  variant="destructiva"
                  className="h-12 w-full text-[14px]"
                  onClick={() => enviarRespondio('no_interesa')}
                  disabled={pendiente || nota.trim().length === 0}
                >
                  <ThumbsDown aria-hidden />
                  No le interesa
                </Button>
                {nota.trim().length === 0 ? (
                  <p className="text-center text-[11.5px] text-texto-2">
                    Se habilitan cuando escribís qué dijo.
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            /*
             * Acá no se escribe nada. Contestó la entrada: todavía no sabe a
             * qué nos dedicamos, así que lo que dijo es un "hola" y anotarlo no
             * le sirve a nadie. Un toque y pasa a la oferta.
             */
            <>
              <p className="text-[13px] leading-relaxed text-texto-2">
                Todavía no sabe a qué nos dedicamos. Al confirmar pasa a{' '}
                <span className="text-texto">Respondió 1er mensaje</span> y te queda el botón para
                mandarle la oferta.
              </p>

              <Button
                variant="primaria"
                className="mt-4 h-12 w-full"
                onClick={() => enviarRespondio()}
                disabled={pendiente}
              >
                {pendiente ? 'Guardando…' : 'Confirmar'}
              </Button>
            </>
          )}
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

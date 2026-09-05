'use client'

import { AlertTriangle, Ban, Check, ClipboardCopy, Megaphone, Repeat, Send } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import type { AvisoParaSetter, RecordatorioParaSetter } from '@/server/setters/avisos'
import { confirmarAviso, responderAviso, verRecordatorio } from '@/server/actions/setter'
import { copiarAlPortapapeles } from '@/lib/copiar'
import { cn } from '@/lib/utils'

/**
 * Lo que se interpone entre el setter y su cola, en orden:
 *
 *   bloqueante → importante → recordatorio → alerta de seguimientos → cola
 *
 * Cada uno existe por un motivo distinto y ninguno es decorativo. El
 * bloqueante, en particular, es la única pantalla de todo el sistema que no se
 * puede cerrar: sirve para "cambiamos el mensaje de apertura", y mandar 60 DMs
 * con el guion viejo cuesta más que los diez segundos que tarda en leerlo.
 */

/** Botón de copiar con confirmación visible. Es el gesto más usado de la app. */
export function BotonCopiar({
  texto,
  etiqueta = 'Copiar',
  className,
  variant = 'secundaria',
}: {
  texto: string
  etiqueta?: string
  className?: string
  variant?: 'secundaria' | 'primaria'
}) {
  const [copiado, setCopiado] = React.useState(false)

  async function copiar(): Promise<void> {
    try {
      if (await copiarAlPortapapeles(texto)) {
        setCopiado(true)
        setTimeout(() => setCopiado(false), 1800)
      } else {
        toast.error('No se pudo copiar. Mantené presionado el texto y copialo a mano.')
      }
    } catch {
      toast.error('No se pudo copiar. Mantené presionado el texto y copialo a mano.')
    }
  }

  return (
    <Button
      variant={copiado ? 'positiva' : variant}
      className={cn('h-11 px-4', className)}
      onClick={() => void copiar()}
    >
      {copiado ? <Check aria-hidden /> : <ClipboardCopy aria-hidden />}
      {copiado ? 'Copiado' : etiqueta}
    </Button>
  )
}

/* ── Mensajes del admin ───────────────────────────────────────────────── */

export function CartelDeMensaje({
  aviso,
  bloqueante,
  onConfirmado,
}: {
  aviso: AvisoParaSetter
  bloqueante: boolean
  onConfirmado: () => void
}) {
  const [pendiente, iniciar] = React.useTransition()
  const [respondiendo, setRespondiendo] = React.useState(false)
  const [texto, setTexto] = React.useState('')

  function confirmar(): void {
    iniciar(async () => {
      const r = await confirmarAviso(aviso.destinatarioId)
      if (r.ok) onConfirmado()
      else toast.error(r.error ?? 'No se pudo confirmar.')
    })
  }

  function responder(): void {
    iniciar(async () => {
      const r = await responderAviso(aviso.destinatarioId, texto)
      if (r.ok) {
        toast.success('Le llegó tu respuesta')
        setRespondiendo(false)
        setTexto('')
        onConfirmado()
      } else {
        toast.error(r.error ?? 'No se pudo enviar.')
      }
    })
  }

  return (
    <Panel
      className={cn(
        'overflow-hidden',
        bloqueante ? 'border-rojo/45' : 'border-ambar/40',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 border-b px-3 py-2',
          bloqueante ? 'border-rojo/35 bg-rojo-tenue' : 'border-ambar/30 bg-ambar-tenue',
        )}
      >
        {bloqueante ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-rojo" aria-hidden />
        ) : (
          <Megaphone className="h-4 w-4 shrink-0 text-ambar" aria-hidden />
        )}
        <span className={cn('rotulo', bloqueante ? 'text-rojo' : 'text-ambar')}>
          {bloqueante ? 'Leelo antes de seguir' : 'Importante'}
        </span>
      </div>

      <div className="px-3 py-3">
        <h2 className="text-[16px]">{aviso.titulo}</h2>
        <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-texto-2">
          {aviso.cuerpo}
        </p>

        {aviso.textoParaCopiar ? (
          <div className="mt-3 rounded-[5px] border border-borde bg-fondo p-2.5">
            <div className="rotulo mb-1.5">Texto nuevo</div>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-texto">
              {aviso.textoParaCopiar}
            </p>
            <BotonCopiar
              texto={aviso.textoParaCopiar}
              etiqueta="Copiar el texto"
              className="mt-2 w-full"
            />
          </div>
        ) : null}

        {respondiendo ? (
          <div className="mt-3">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Ej: no me anda la cuenta B"
              className="w-full resize-y rounded-[5px] border border-borde bg-fondo px-2.5 py-2 text-[16px] leading-relaxed text-texto focus:border-acento focus:outline-none"
            />
            <div className="mt-2 flex gap-2">
              <Button
                variant="primaria"
                className="h-11 flex-1"
                onClick={responder}
                disabled={pendiente || texto.trim().length === 0}
              >
                Enviar
              </Button>
              <Button
                variant="fantasma"
                className="h-11"
                onClick={() => setRespondiendo(false)}
                disabled={pendiente}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="primaria"
              className="h-12 flex-1"
              onClick={confirmar}
              disabled={pendiente}
            >
              <Check aria-hidden />
              Entendido
            </Button>
            <Button
              variant="secundaria"
              className="h-12"
              onClick={() => setRespondiendo(true)}
              disabled={pendiente}
            >
              Responder
            </Button>
          </div>
        )}
      </div>
    </Panel>
  )
}

/** Anuncio clavado arriba hasta que el admin lo saque. */
export function AnuncioFijado({ aviso }: { aviso: AvisoParaSetter }) {
  return (
    <div className="rounded-[6px] border border-borde bg-elevada px-3 py-2">
      <div className="flex items-center gap-1.5">
        <Megaphone className="h-3.5 w-3.5 shrink-0 text-ambar" aria-hidden />
        <span className="text-[13px] font-medium text-texto">{aviso.titulo}</span>
      </div>
      <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-texto-2">
        {aviso.cuerpo}
      </p>
      {aviso.textoParaCopiar ? (
        <BotonCopiar texto={aviso.textoParaCopiar} etiqueta="Copiar el texto" className="mt-2" />
      ) : null}
    </div>
  )
}

/* ── Recordatorio del admin ───────────────────────────────────────────── */

export function CartelDeRecordatorio({
  recordatorio,
  onCerrado,
}: {
  recordatorio: RecordatorioParaSetter
  onCerrado: () => void
}) {
  const [pendiente, iniciar] = React.useTransition()

  return (
    <Panel className="border-ambar/40">
      <div className="px-3 py-3">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-ambar" aria-hidden />
          <span className="rotulo text-ambar">Recordatorio</span>
        </div>
        <p className="mt-1.5 text-[14px] leading-relaxed text-texto">{recordatorio.texto}</p>
        <Button
          variant="primaria"
          className="mt-3 h-12 w-full"
          disabled={pendiente}
          onClick={() =>
            iniciar(async () => {
              await verRecordatorio(recordatorio.id)
              onCerrado()
            })
          }
        >
          Entendido, lo hago
        </Button>
      </div>
    </Panel>
  )
}

/* ── Alerta de seguimientos ───────────────────────────────────────────── */

/**
 * Lo primero que ve el día que le tocan seguimientos. No es un aviso al
 * costado: es la pantalla de entrada, antes de la cola de leads nuevos. Es lo
 * que hace que efectivamente los hagan.
 */
/**
 * Con qué arranca el día, cuando hay seguimientos esperando.
 *
 * Le muestra **los dos números juntos** a propósito. El cartel decía solo
 * "hoy te tocan N seguimientos" y ese N incluía aperturas, así que el setter
 * arrancaba creyendo que iba a seguir charlas y le salían desconocidos. Ahora
 * el número de seguimientos es solo de seguimientos, y al lado está el otro
 * trabajo, para que sepa desde el principio que son dos cosas distintas.
 */
export function CartelDeSeguimientos({
  cuantos,
  atrasados,
  diasDeAtraso,
  porContactar,
  onEmpezar,
}: {
  cuantos: number
  atrasados: number
  diasDeAtraso: number
  /** Lo que le espera en la otra lista. Va acá para que no lo descubra después. */
  porContactar: number
  onEmpezar: () => void
}) {
  return (
    <Panel className="px-4 py-6 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[6px] border border-acento/40 bg-acento-tenue">
        <Repeat className="h-5 w-5 text-ambar" aria-hidden />
      </div>
      <h2 className="mt-3 text-[19px]">
        Hoy te tocan <span className="dato text-ambar">{cuantos}</span>{' '}
        {cuantos === 1 ? 'seguimiento' : 'seguimientos'}
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-texto-2">
        {atrasados > 0
          ? `${atrasados} ${atrasados === 1 ? 'está atrasado' : 'están atrasados'} ${
              diasDeAtraso === 1 ? '1 día' : `${diasDeAtraso} días`
            }. Los que ya te leyeron una vez son los que más chance tienen de contestar.`
          : 'Son chats que ya están abiertos: no gastan cupo. Por eso van primero.'}
      </p>

      <p className="mt-3 rounded-[5px] border border-borde bg-fondo px-2.5 py-2 text-[12.5px] leading-relaxed text-texto-2">
        {porContactar > 0 ? (
          <>
            Aparte tenés <span className="dato text-texto">{porContactar}</span>{' '}
            {porContactar === 1 ? 'lead' : 'leads'} para contactar por primera vez. Son otra lista,
            y esa sí gasta cupo.
          </>
        ) : (
          'No tenés leads nuevos para contactar hoy: son otra lista y está vacía.'
        )}
      </p>

      <Button variant="primaria" className="mt-4 h-12 w-full" onClick={onEmpezar}>
        <Send aria-hidden />
        Empezar seguimientos
      </Button>
    </Panel>
  )
}

/* ── Cambio de cuenta ─────────────────────────────────────────────────── */

/**
 * A los 30 con la cuenta activa, la pantalla se bloquea de verdad: los botones
 * de envío quedan deshabilitados, no es un aviso que se pueda ignorar. El
 * motivo va escrito, porque un límite sin motivo se saltea.
 */
export function CartelDeCambio({
  cuentaActual,
  cupo,
  siguiente,
  motivo,
  onCambiar,
  pendiente,
  esperandoEnLaSiguiente,
}: {
  cuentaActual: string
  cupo: number
  siguiente: { id: string; igUsername: string } | null
  motivo: string
  onCambiar: (cuentaId: string) => void
  pendiente: boolean
  /**
   * Mensajes que esperan en la cuenta siguiente y que solo pueden salir de ahí:
   * sus seguimientos y sus reintentos, porque los dos tienen el hilo en esa
   * cuenta. Le da sentido al cambio.
   */
  esperandoEnLaSiguiente: number
}) {
  return (
    <Panel className="border-rojo/45">
      <div className="flex items-center gap-2 border-b border-rojo/35 bg-rojo-tenue px-3 py-2">
        <Ban className="h-4 w-4 shrink-0 text-rojo" aria-hidden />
        <span className="dato text-[13px] text-rojo">
          {cupo} / {cupo} · @{cuentaActual}
        </span>
      </div>

      <div className="px-4 py-5 text-center">
        <h2 className="text-[18px]">Llegaste al límite de hoy con esta cuenta.</h2>

        {siguiente ? (
          <>
            <p className="mt-2 text-[14px] leading-relaxed text-texto-2">
              Cambiá a <span className="dato text-texto">@{siguiente.igUsername}</span> en Instagram
              y confirmá acá.
            </p>

            {/* Qué le espera del otro lado. Un cambio de cuenta sin motivo se
                pospone; con el número a la vista, no. */}
            {esperandoEnLaSiguiente > 0 ? (
              <p className="mt-1.5 text-[13px] text-ambar">
                Ahí te esperan <span className="dato">{esperandoEnLaSiguiente}</span>{' '}
                {esperandoEnLaSiguiente === 1 ? 'mensaje' : 'mensajes'} que solo se pueden mandar
                desde esa cuenta.
              </p>
            ) : null}
            <Button
              variant="primaria"
              className="mt-4 h-12 w-full"
              disabled={pendiente}
              onClick={() => onCambiar(siguiente.id)}
            >
              Ya cambié a @{siguiente.igUsername}
            </Button>
          </>
        ) : (
          <p className="mt-2 text-[14px] leading-relaxed text-texto-2">
            Terminaste por hoy con esta cuenta. Seguí mañana.
          </p>
        )}

        <p className="mt-4 border-t border-borde pt-3 text-[12px] leading-relaxed text-texto-2">
          {motivo}
        </p>
      </div>
    </Panel>
  )
}

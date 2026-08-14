'use client'

import { ArrowRight, Ban, Check, ExternalLink, Pencil, Send, Undo2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Chip, Panel } from '@/components/ui/panel'
import { STAGE_META } from '@/db/enums'
import { formatearTelefono } from '@/lib/phone-ar'
import { haceCuanto } from '@/lib/tz'
import { cn } from '@/lib/utils'
import { PRIORIDAD_META, type ColaDelDia, type ItemDeCola } from '@/lib/dispatch-types'
import {
  confirmarEnviado,
  enviarPorApi,
  deshacerUltimo,
  noContactar,
  registrarApertura,
  saltear,
} from '@/server/actions/dispatch'

/**
 * El Despachador.
 *
 * La idea es que el trabajo sea: mirar quién sigue, apretar una tecla, pegar,
 * mandar, confirmar. Con 300 mensajes por día el mouse es la diferencia entre
 * 20 minutos y 2 horas, así que todo tiene atajo.
 */
export function Cola({ cola }: { cola: ColaDelDia }) {
  const [indice, setIndice] = React.useState(0)
  const [hechos, setHechos] = React.useState<Set<string>>(new Set())
  const [abierto, setAbierto] = React.useState<string | null>(null)
  const [editando, setEditando] = React.useState(false)
  const [texto, setTexto] = React.useState('')
  const [ultimo, setUltimo] = React.useState<{
    messageId: string
    contactId: string
    paso: number
  } | null>(null)
  const [pendiente, iniciar] = React.useTransition()

  const pendientes = React.useMemo(
    () => cola.items.filter((i) => !hechos.has(i.contactId)),
    [cola.items, hechos],
  )
  const actual = pendientes[Math.min(indice, Math.max(pendientes.length - 1, 0))] ?? null

  // Al cambiar de contacto, el mensaje vuelve al original.
  React.useEffect(() => {
    setTexto(actual?.mensaje ?? '')
    setEditando(false)
    setAbierto(null)
  }, [actual?.contactId, actual?.mensaje])

  const marcarHecho = React.useCallback((id: string) => {
    setHechos((s) => new Set(s).add(id))
    setIndice(0)
  }, [])

  /* ── Acciones ─────────────────────────────────────────────────────── */

  const abrirChat = React.useCallback(() => {
    if (!actual || !texto) return
    const url =
      actual.channel === 'whatsapp'
        ? `https://wa.me/${actual.destino}?text=${encodeURIComponent(texto)}`
        : `https://ig.me/m/${actual.destino}`

    if (actual.channel === 'instagram') {
      void navigator.clipboard.writeText(texto).then(
        () => toast.success('Mensaje copiado — pegá con Ctrl+V'),
        () => toast.error('No se pudo copiar. Copialo a mano del cuadro de arriba.'),
      )
    }

    window.open(url, '_blank', 'noopener')
    setAbierto(actual.contactId)
    void registrarApertura(actual.contactId, actual.cuentaId, actual.channel, texto)
  }, [actual, texto])

  /**
   * Envío automático: un click y el servidor manda por Chatwoot desde el número
   * asignado. No se abre WhatsApp ni se toca ninguna cuenta.
   */
  const enviarSolo = React.useCallback(() => {
    if (!actual || !texto) return
    const item = actual
    iniciar(async () => {
      const r = await enviarPorApi({
        contactId: item.contactId,
        accountId: item.cuentaId,
        body: texto,
        paso: item.paso,
        templateId: item.templateId,
        templateVariant: item.templateVariant,
      })

      if (!r.ok) {
        toast.error(r.error)
        return
      }

      if (r.via === 'chatwoot' || r.via === 'evolution') {
        toast.success(`Enviado por ${item.cuentaCode} · ${r.usadoHoy}/${r.cupo} hoy`)
      } else {
        // No se pudo mandar solo: el mensaje no se pierde, sale por link.
        toast.warning('No se pudo mandar solo — se abre WhatsApp para que salga igual', {
          description: r.motivo,
          duration: 7000,
        })
        window.open(r.link, '_blank', 'noopener')
      }
      marcarHecho(item.contactId)
    })
  }, [actual, texto, marcarHecho])

  const confirmar = React.useCallback(() => {
    if (!actual || !texto) return
    const item = actual
    iniciar(async () => {
      const r = await confirmarEnviado({
        contactId: item.contactId,
        accountId: item.cuentaId,
        channel: item.channel,
        body: texto,
        paso: item.paso,
        templateId: item.templateId,
        templateVariant: item.templateVariant,
      })
      if (r.ok) {
        toast.success(`Enviado · ${item.cuentaCode} lleva ${r.usadoHoy}/${r.cupo}`)
        if (r.messageId) {
          setUltimo({ messageId: r.messageId, contactId: item.contactId, paso: item.paso - 1 })
        }
        marcarHecho(item.contactId)
      } else {
        toast.error(r.error ?? 'No se pudo registrar el envío.')
      }
    })
  }, [actual, texto, marcarHecho])

  const saltearActual = React.useCallback(() => {
    if (!actual) return
    const item = actual
    marcarHecho(item.contactId)
    iniciar(async () => {
      const r = await saltear(item.contactId)
      if (!r.ok) toast.error(r.error ?? 'No se pudo saltear.')
      else toast.success('Salteado — vuelve mañana')
    })
  }, [actual, marcarHecho])

  const descartarActual = React.useCallback(() => {
    if (!actual) return
    const item = actual
    marcarHecho(item.contactId)
    iniciar(async () => {
      const r = await noContactar(item.contactId)
      if (!r.ok) toast.error(r.error ?? 'No se pudo marcar.')
      else toast.success('Marcado como no contactar')
    })
  }, [actual, marcarHecho])

  const deshacer = React.useCallback(() => {
    if (!ultimo) return
    const u = ultimo
    setUltimo(null)
    iniciar(async () => {
      const r = await deshacerUltimo(u.messageId, u.contactId, u.paso)
      if (r.ok) {
        toast.success('Deshecho — el cupo se liberó')
        setHechos((s) => {
          const n = new Set(s)
          n.delete(u.contactId)
          return n
        })
      } else toast.error(r.error ?? 'No se pudo deshacer.')
    })
  }, [ultimo])

  /* ── Atajos de teclado ────────────────────────────────────────────── */

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const enCampo = ['INPUT', 'TEXTAREA', 'SELECT'].includes(
        (e.target as HTMLElement)?.tagName ?? '',
      )
      if (enCampo && e.key !== 'Escape') return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      switch (e.key.toLowerCase()) {
        case 'enter':
          e.preventDefault()
          if (actual?.envioAutomatico) enviarSolo()
          else abrirChat()
          break
        case 's':
          e.preventDefault()
          confirmar()
          break
        case 'arrowright':
          e.preventDefault()
          saltearActual()
          break
        case 'x':
          e.preventDefault()
          descartarActual()
          break
        case 'e':
          e.preventDefault()
          setEditando(true)
          break
        case 'z':
          e.preventDefault()
          deshacer()
          break
        case 'escape':
          setEditando(false)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [abrirChat, enviarSolo, actual?.envioAutomatico, confirmar, saltearActual, descartarActual, deshacer])

  /* ── Pantallas ────────────────────────────────────────────────────── */

  if (pendientes.length === 0) {
    return (
      <Panel className="px-6 py-14 text-center">
        <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-[5px] border border-verde/35 bg-verde/10">
          <Check className="h-4 w-4 text-verde" aria-hidden />
        </div>
        <h2 className="text-[15px]">
          {hechos.size > 0 ? 'Terminaste la cola de hoy' : 'No hay nada para mandar hoy'}
        </h2>
        <p className="mt-1.5 text-[12.5px] text-texto-2">
          {hechos.size > 0
            ? `Despachaste ${hechos.size} contactos. Mañana aparecen los seguimientos que correspondan.`
            : 'Cuando haya contactos con seguimiento vencido o sin primer mensaje, aparecen acá.'}
        </p>
        {ultimo ? (
          <Button variant="fantasma" className="mt-4" onClick={deshacer} disabled={pendiente}>
            <Undo2 aria-hidden />
            Deshacer el último
          </Button>
        ) : null}
      </Panel>
    )
  }

  if (!actual) return null

  const bloqueado = actual.mensaje === null

  return (
    <div className="space-y-2">
      {/* ── Progreso ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <span className="dato text-texto">
          {hechos.size}
          <span className="text-texto-2">/{cola.items.length}</span>
        </span>
        <div className="h-1 min-w-[120px] flex-1 overflow-hidden rounded-[2px] bg-borde/50">
          <div
            className="h-full bg-ambar transition-[width] duration-200 ease-[cubic-bezier(0.2,0,0,1)]"
            style={{ width: `${(hechos.size / Math.max(cola.items.length, 1)) * 100}%` }}
          />
        </div>
        {cola.totales.vencidos > 0 ? (
          <Chip tono="negativo">{cola.totales.vencidos} vencidos</Chip>
        ) : null}
        {cola.totales.hoy > 0 ? <Chip tono="activo">{cola.totales.hoy} de hoy</Chip> : null}
        {cola.totales.nuevos > 0 ? <Chip>{cola.totales.nuevos} nuevos</Chip> : null}
        {ultimo ? (
          <Button variant="fantasma" size="sm" onClick={deshacer} disabled={pendiente}>
            <Undo2 aria-hidden />
            Deshacer (Z)
          </Button>
        ) : null}
      </div>

      {/* ── Tarjeta del contacto ─────────────────────────────────────── */}
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-borde px-3 py-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="truncate text-[16px]">{actual.businessName}</h2>
              <Chip tono={PRIORIDAD_META[actual.prioridad].tono}>
                {PRIORIDAD_META[actual.prioridad].label}
              </Chip>
              <Chip tono={STAGE_META[actual.stage].tone}>{STAGE_META[actual.stage].label}</Chip>
            </div>
            <p className="mt-0.5 text-[12.5px] text-texto-2">
              {actual.contactName ?? 'Sin nombre'}
              {actual.niche ? ` · ${actual.niche}` : ''}
              {actual.city ? ` · ${actual.city}` : ''}
            </p>
            {actual.bought ? (
              <p className="mt-0.5 text-[12px] text-texto-2">
                Compró: <span className="text-texto">{actual.bought}</span>
              </p>
            ) : null}
          </div>

          <div className="text-right">
            <div className="rotulo">Score</div>
            <div className="dato text-[20px] leading-none text-texto">{actual.score}</div>
            <div className="mt-1 text-[11px] text-texto-2">
              {actual.sentCount} enviados · último {haceCuanto(actual.lastOutboundAt)}
            </div>
          </div>
        </div>

        {/* ── Desde qué número sale ──────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-borde bg-elevada/40 px-3 py-1.5">
          <span className="text-[12px] text-texto-2">
            Sale desde{' '}
            <span className="dato text-texto">{actual.cuentaCode}</span>{' '}
            <span className="text-texto-2">{actual.cuentaLabel}</span>
          </span>
          <span className="dato text-[11.5px] text-texto-2">
            {actual.cuentaUsado}/{actual.cuentaTecho} hoy
            {actual.cuentaTecho < actual.cuentaCupo ? (
              <span title={`El cupo real es ${actual.cuentaCupo}; el resto queda para tus respuestas.`}>
                {' '}
                (cupo {actual.cuentaCupo})
              </span>
            ) : null}
          </span>
        </div>

        {/* ── Mensaje ────────────────────────────────────────────────── */}
        <div className="p-3">
          {bloqueado ? (
            <div className="rounded-[5px] border border-rojo/35 bg-rojo/8 px-3 py-2.5">
              <p className="text-[12.5px] font-medium text-rojo">No se puede armar el mensaje</p>
              <p className="mt-1 text-[12px] text-texto-2">{actual.motivoSaltado}</p>
              <p className="mt-1.5 text-[11.5px] text-texto-2">
                No se manda a medias: completá el dato en la ficha del contacto o ajustá la
                plantilla, y vuelve a aparecer.
              </p>
            </div>
          ) : editando ? (
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onBlur={() => setEditando(false)}
              autoFocus
              rows={5}
              className="w-full resize-y rounded-[5px] border border-ambar bg-fondo px-2.5 py-2 text-[13px] leading-relaxed text-texto focus:outline-none"
            />
          ) : (
            <button
              onClick={() => setEditando(true)}
              className="w-full rounded-[5px] border border-borde bg-fondo px-2.5 py-2 text-left text-[13px] leading-relaxed text-texto transition-colors duration-150 hover:border-[#42525f]"
              title="Editar solo para este contacto (E)"
            >
              {texto}
            </button>
          )}

          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="dato text-[11px] text-texto-2">
              {actual.channel === 'whatsapp'
                ? formatearTelefono(actual.destino)
                : `@${actual.destino}`}
              {' · '}
              {texto.length} caracteres
              {actual.templateVariant !== null ? ` · variante ${actual.templateVariant + 1}` : ''}
            </span>
            {!bloqueado ? (
              <Button variant="fantasma" size="sm" onClick={() => setEditando(true)}>
                <Pencil aria-hidden />
                Editar (E)
              </Button>
            ) : null}
          </div>
        </div>

        {/* ── Acciones ───────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-borde px-3 py-2">
          {actual.envioAutomatico ? (
            /* Un click y sale. No se abre WhatsApp: manda el servidor desde el
               número asignado. */
            <Button variant="primaria" onClick={enviarSolo} disabled={pendiente || bloqueado}>
              <Send aria-hidden />
              {pendiente ? 'Enviando…' : 'Enviar'}
              <Atajo>⏎</Atajo>
            </Button>
          ) : (
            <>
              {!bloqueado ? (
                <Button
                  variant={abierto === actual.contactId ? 'secundaria' : 'primaria'}
                  onClick={abrirChat}
                  title={
                    actual.channel === 'whatsapp'
                      ? 'Para que salga solo, conectá Evolution o Chatwoot en Configuración.'
                      : 'Instagram no tiene API para iniciar conversaciones: va por portapapeles.'
                  }
                >
                  <ExternalLink aria-hidden />
                  {actual.channel === 'whatsapp' ? 'Abrir WhatsApp' : 'Copiar y abrir Instagram'}
                  <Atajo>⏎</Atajo>
                </Button>
              ) : null}

              <Button
                variant="positiva"
                onClick={confirmar}
                disabled={pendiente || bloqueado}
                title="Confirma que el mensaje salió. Recién acá se consume el cupo."
              >
                <Check aria-hidden />
                Enviado
                <Atajo>S</Atajo>
              </Button>
            </>
          )}

          <Button variant="secundaria" onClick={saltearActual} disabled={pendiente}>
            Saltear
            <ArrowRight aria-hidden />
            <Atajo>→</Atajo>
          </Button>

          <Button
            variant="destructiva"
            onClick={descartarActual}
            disabled={pendiente}
            className="ml-auto"
          >
            <Ban aria-hidden />
            No contactar
            <Atajo>X</Atajo>
          </Button>
        </div>
      </Panel>

      {/* ── Los que siguen ───────────────────────────────────────────── */}
      <Panel>
        <div className="rotulo border-b border-borde px-3 py-1.5">Después siguen</div>
        <div className="divide-y divide-borde/60">
          {pendientes.slice(1, 6).map((i) => (
            <Siguiente key={i.contactId} item={i} onIr={() => setIndice(pendientes.indexOf(i))} />
          ))}
          {pendientes.length <= 1 ? (
            <p className="px-3 py-2 text-[12px] text-texto-2">Es el último de la cola.</p>
          ) : null}
        </div>
      </Panel>

      <p className="px-1 text-[11px] text-texto-2">
        Atajos: <Tecla>⏎</Tecla> abrir · <Tecla>S</Tecla> enviado · <Tecla>→</Tecla> saltear ·{' '}
        <Tecla>X</Tecla> no contactar · <Tecla>E</Tecla> editar · <Tecla>Z</Tecla> deshacer
      </p>
    </div>
  )
}

function Siguiente({ item, onIr }: { item: ItemDeCola; onIr: () => void }) {
  return (
    <button
      onClick={onIr}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-elevada/50"
    >
      <span
        className={cn(
          'block h-1.5 w-1.5 shrink-0 rounded-full',
          item.prioridad === 'vencido' ? 'bg-rojo' : item.prioridad === 'hoy' ? 'bg-ambar' : 'bg-texto-2/50',
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-[12.5px]">{item.businessName}</span>
      {item.mensaje === null ? (
        <Chip tono="negativo">falta un dato</Chip>
      ) : (
        <span className="dato shrink-0 text-[11px] text-texto-2">{item.cuentaCode}</span>
      )}
      <span className="dato w-7 shrink-0 text-right text-[11px] text-texto-2">{item.score}</span>
    </button>
  )
}

function Atajo({ children }: { children: React.ReactNode }) {
  return (
    <span className="dato ml-1 rounded-[3px] border border-current/30 px-1 text-[9.5px] opacity-70">
      {children}
    </span>
  )
}

function Tecla({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="dato rounded-[3px] border border-borde bg-elevada px-1 text-[10px] text-texto-2">
      {children}
    </kbd>
  )
}

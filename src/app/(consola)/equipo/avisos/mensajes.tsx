'use client'

import { Pin, PinOff, Send } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Chip, Panel, PanelHeader } from '@/components/ui/panel'
import { MENSAJE_NIVELES, NIVEL_META, type MensajeNivel, type UserStatus } from '@/db/enums'
import { formatCorto, haceCuanto } from '@/lib/tz'
import { cn } from '@/lib/utils'
import { crearMensajeEquipo, fijarMensaje, reenviarANoLeidos } from '@/server/actions/avisos'
import type { MensajeEnviado } from '@/server/setters/avisos'

/**
 * Escribirle al equipo desde el panel.
 *
 * Los tres niveles cambian de verdad lo que ve el setter, y por eso están
 * explicados en la pantalla: un "bloqueante" mal usado le traba el trabajo a
 * seis personas, y uno bien usado evita que manden 300 DMs con el guion viejo.
 */
export function Mensajes({
  mensajes,
  setters,
}: {
  mensajes: MensajeEnviado[]
  setters: Array<{ id: string; nombre: string; estado: UserStatus }>
}) {
  const router = useRouter()
  const [pendiente, iniciar] = React.useTransition()

  const [nivel, setNivel] = React.useState<MensajeNivel>('aviso')
  const [titulo, setTitulo] = React.useState('')
  const [cuerpo, setCuerpo] = React.useState('')
  const [textoParaCopiar, setTextoParaCopiar] = React.useState('')
  const [conTexto, setConTexto] = React.useState(false)
  const [fijado, setFijado] = React.useState(false)
  const [destinatarios, setDestinatarios] = React.useState<string[]>([])

  const aTodos = destinatarios.length === 0

  function enviar(): void {
    iniciar(async () => {
      const r = await crearMensajeEquipo({
        nivel,
        titulo,
        cuerpo,
        textoParaCopiar: conTexto ? textoParaCopiar : null,
        fijado,
        destinatarios,
      })
      if (r.ok) {
        toast.success(
          r.enviados === 1 ? 'Se lo mandé a 1 setter' : `Se lo mandé a ${r.enviados} setters`,
        )
        setTitulo('')
        setCuerpo('')
        setTextoParaCopiar('')
        setConTexto(false)
        setFijado(false)
        setNivel('aviso')
        router.refresh()
      } else {
        toast.error(r.error ?? 'No se pudo mandar.')
      }
    })
  }

  return (
    <div className="space-y-3">
      <Panel>
        <PanelHeader titulo="Nuevo mensaje" />

        <div className="space-y-3 px-3 py-3">
          <div>
            <span className="mb-1 block text-[11px] font-medium text-texto-2">Cuánto interrumpe</span>
            <div className="flex flex-wrap gap-1.5">
              {MENSAJE_NIVELES.map((n) => (
                <button
                  key={n}
                  onClick={() => setNivel(n)}
                  className={cn(
                    'h-7.5 rounded-[5px] border px-3 text-[12.5px] font-medium',
                    nivel === n
                      ? 'border-acento/40 bg-acento-tenue text-acento'
                      : 'border-borde bg-elevada text-texto-2',
                  )}
                >
                  {NIVEL_META[n].label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-texto-2">
              {NIVEL_META[nivel].detalle}
            </p>
          </div>

          <Field label="Título">
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Cambiamos el mensaje de apertura"
            />
          </Field>

          <Field label="Mensaje">
            <Textarea
              value={cuerpo}
              onChange={(e) => setCuerpo(e.target.value)}
              rows={4}
              placeholder="Desde hoy usen el texto de abajo. No manden más el anterior."
            />
          </Field>

          {conTexto ? (
            <Field
              label="Texto para copiar"
              hint="Le aparece con su propio botón de copiar. Es el caso más común."
            >
              <Textarea
                value={textoParaCopiar}
                onChange={(e) => setTextoParaCopiar(e.target.value)}
                rows={4}
              />
            </Field>
          ) : (
            <Button variant="fantasma" size="sm" onClick={() => setConTexto(true)}>
              Adjuntar un texto para copiar
            </Button>
          )}

          <div>
            <span className="mb-1 block text-[11px] font-medium text-texto-2">Para quién</span>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setDestinatarios([])}
                className={cn(
                  'h-7 rounded-[4px] border px-2.5 text-[12px]',
                  aTodos ? 'border-acento/40 bg-acento-tenue text-acento' : 'border-borde bg-elevada text-texto-2',
                )}
              >
                Todos
              </button>
              {setters.map((s) => {
                const elegido = destinatarios.includes(s.id)
                return (
                  <button
                    key={s.id}
                    onClick={() =>
                      setDestinatarios((d) =>
                        elegido ? d.filter((x) => x !== s.id) : [...d, s.id],
                      )
                    }
                    className={cn(
                      'h-7 rounded-[4px] border px-2.5 text-[12px]',
                      elegido
                        ? 'border-acento/40 bg-acento-tenue text-acento'
                        : 'border-borde bg-elevada text-texto-2',
                    )}
                  >
                    {s.nombre}
                  </button>
                )
              })}
            </div>
          </div>

          <label className="flex items-center gap-2 text-[12.5px] text-texto-2">
            <input
              type="checkbox"
              checked={fijado}
              onChange={(e) => setFijado(e.target.checked)}
              className="h-4 w-4 accent-[#1FC79E]"
            />
            Dejarlo fijo arriba de su pantalla hasta que lo saque
          </label>
        </div>

        <div className="flex justify-end border-t border-borde px-3 py-2">
          <Button
            variant="primaria"
            onClick={enviar}
            disabled={pendiente || titulo.trim().length < 2 || cuerpo.trim().length < 2}
          >
            <Send aria-hidden />
            {pendiente ? 'Mandando…' : aTodos ? 'Mandar a todos' : `Mandar a ${destinatarios.length}`}
          </Button>
        </div>
      </Panel>

      <Panel>
        <PanelHeader titulo="Mandados" descripcion="Quién lo leyó, a qué hora, y quiénes faltan." />

        {mensajes.length === 0 ? (
          <p className="px-3 py-4 text-[12.5px] text-texto-2">Todavía no mandaste ninguno.</p>
        ) : (
          <div className="divide-y divide-borde/60">
            {mensajes.map((m) => (
              <MensajeMandado key={m.id} m={m} pendiente={pendiente} iniciar={iniciar} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

function MensajeMandado({
  m,
  pendiente,
  iniciar,
}: {
  m: MensajeEnviado
  pendiente: boolean
  iniciar: React.TransitionStartFunction
}) {
  const router = useRouter()
  const leyeron = m.destinatarios.filter((d) => d.leidoAt !== null)
  const faltan = m.destinatarios.filter((d) => d.leidoAt === null)
  const respuestas = m.destinatarios.filter((d) => d.respuesta)

  return (
    <div className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13.5px] text-texto">{m.titulo}</span>
        {m.nivel !== 'aviso' ? (
          <Chip tono={NIVEL_META[m.nivel].tone}>{NIVEL_META[m.nivel].label}</Chip>
        ) : null}
        {m.fijado ? (
          <Chip tono="activo">
            <Pin className="h-3 w-3" aria-hidden />
            Fijado
          </Chip>
        ) : null}
        <span className="ml-auto text-[11.5px] text-texto-2">
          {m.autor ? `${m.autor} · ` : ''}
          {haceCuanto(m.createdAt)}
        </span>
      </div>

      <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-texto-2">
        {m.cuerpo}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn(
            'dato text-[12px]',
            faltan.length === 0 ? 'text-verde' : 'text-ambar',
          )}
        >
          Leído por {leyeron.length} de {m.destinatarios.length}
        </span>

        {leyeron.length > 0 ? (
          <span className="text-[11.5px] text-texto-2">
            {leyeron.map((d) => `${d.nombre} ${formatCorto(d.leidoAt)}`).join(' · ')}
          </span>
        ) : null}

        {faltan.length > 0 ? (
          <>
            <span className="text-[11.5px] text-rojo">
              Faltan: {faltan.map((d) => d.nombre).join(', ')}
            </span>
            <Button
              variant="secundaria"
              size="sm"
              disabled={pendiente}
              onClick={() =>
                iniciar(async () => {
                  const r = await reenviarANoLeidos(m.id)
                  if (r.ok) toast.success(`Reenviado a ${r.enviados}`)
                  else toast.error(r.error ?? 'No se pudo reenviar.')
                })
              }
            >
              Reenviar a los que faltan
            </Button>
          </>
        ) : null}

        <Button
          variant="fantasma"
          size="sm"
          disabled={pendiente}
          onClick={() =>
            iniciar(async () => {
              const r = await fijarMensaje(m.id, !m.fijado)
              if (r.ok) router.refresh()
              else toast.error(r.error ?? 'No se pudo.')
            })
          }
        >
          {m.fijado ? <PinOff aria-hidden /> : <Pin aria-hidden />}
          {m.fijado ? 'Sacar de arriba' : 'Fijar arriba'}
        </Button>
      </div>

      {respuestas.length > 0 ? (
        <div className="mt-2 space-y-1 border-t border-borde/60 pt-2">
          {respuestas.map((d) => (
            <p key={d.setterId} className="text-[12px] text-texto-2">
              <span className="text-texto">{d.nombre}:</span> {d.respuesta}
              <span className="ml-1.5 text-[11px]">{haceCuanto(d.respondidoAt)}</span>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

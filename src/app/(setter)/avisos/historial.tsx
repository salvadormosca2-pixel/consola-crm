'use client'

import { Check, Megaphone } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { BotonCopiar } from '@/app/(setter)/hoy/carteles'
import { Button } from '@/components/ui/button'
import { Chip, Panel } from '@/components/ui/panel'
import { NIVEL_META } from '@/db/enums'
import { formatLargo, haceCuanto } from '@/lib/tz'
import { confirmarAviso, responderAviso } from '@/server/actions/setter'
import type { AvisoParaSetter, RecordatorioParaSetter } from '@/server/setters/avisos'
import { cn } from '@/lib/utils'

/**
 * El historial completo de lo que le mandé.
 *
 * Sirve para volver a buscar el guion nuevo tres días después sin tener que
 * pedírmelo de nuevo por WhatsApp, que es la razón por la que esta sección
 * existe en vez de un grupo aparte.
 */
export function Historial({
  avisos,
  recordatorios,
}: {
  avisos: AvisoParaSetter[]
  recordatorios: RecordatorioParaSetter[]
}) {
  return (
    <div className="space-y-2.5">
      {avisos.map((a) => (
        <Aviso key={a.id} aviso={a} />
      ))}

      {recordatorios.length > 0 ? (
        <>
          <h2 className="rotulo px-0.5 pt-2">Recordatorios</h2>
          {recordatorios.map((r) => (
            <div key={r.id} className="rounded-[6px] border border-borde bg-superficie px-3 py-2">
              <p className="text-[13px] leading-relaxed text-texto">{r.texto}</p>
              <p className="mt-1 text-[11.5px] text-texto-2">{haceCuanto(r.createdAt)}</p>
            </div>
          ))}
        </>
      ) : null}
    </div>
  )
}

function Aviso({ aviso }: { aviso: AvisoParaSetter }) {
  const router = useRouter()
  const [pendiente, iniciar] = React.useTransition()
  const [respondiendo, setRespondiendo] = React.useState(false)
  const [texto, setTexto] = React.useState('')

  const meta = NIVEL_META[aviso.nivel]

  return (
    <Panel className={cn(aviso.leidoAt === null && 'border-ambar/45')}>
      <div className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[15px] leading-tight">{aviso.titulo}</h3>
          {aviso.fijado ? (
            <Chip tono="activo">
              <Megaphone className="h-3 w-3" aria-hidden />
              Fijado
            </Chip>
          ) : aviso.nivel !== 'aviso' ? (
            <Chip tono={meta.tone}>{meta.label}</Chip>
          ) : null}
        </div>

        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-texto-2">
          {aviso.cuerpo}
        </p>

        {aviso.textoParaCopiar ? (
          <div className="mt-2.5 rounded-[5px] border border-borde bg-fondo p-2.5">
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-texto">
              {aviso.textoParaCopiar}
            </p>
            <BotonCopiar texto={aviso.textoParaCopiar} etiqueta="Copiar" className="mt-2 w-full" />
          </div>
        ) : null}

        <p className="mt-2 text-[11.5px] text-texto-2">
          {aviso.autor ? `${aviso.autor} · ` : ''}
          {formatLargo(aviso.createdAt)}
          {aviso.leidoAt ? ' · leído' : ''}
        </p>

        {aviso.respuesta ? (
          <p className="mt-2 rounded-[4px] border border-borde bg-elevada px-2 py-1.5 text-[12.5px] text-texto-2">
            Le respondiste: <span className="text-texto">{aviso.respuesta}</span>
          </p>
        ) : respondiendo ? (
          <div className="mt-2">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={3}
              autoFocus
              className="w-full resize-y rounded-[5px] border border-borde bg-fondo px-2.5 py-2 text-[16px] text-texto focus:border-acento focus:outline-none"
            />
            <div className="mt-2 flex gap-2">
              <Button
                variant="primaria"
                className="h-11 flex-1"
                disabled={pendiente || texto.trim().length === 0}
                onClick={() =>
                  iniciar(async () => {
                    const r = await responderAviso(aviso.destinatarioId, texto)
                    if (r.ok) {
                      toast.success('Le llegó tu respuesta')
                      setRespondiendo(false)
                      router.refresh()
                    } else {
                      toast.error(r.error ?? 'No se pudo enviar.')
                    }
                  })
                }
              >
                Enviar
              </Button>
              <Button variant="fantasma" className="h-11" onClick={() => setRespondiendo(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex gap-2">
            {aviso.leidoAt === null ? (
              <Button
                variant="primaria"
                className="h-10 flex-1"
                disabled={pendiente}
                onClick={() =>
                  iniciar(async () => {
                    await confirmarAviso(aviso.destinatarioId)
                    router.refresh()
                  })
                }
              >
                <Check aria-hidden />
                Entendido
              </Button>
            ) : null}
            <Button
              variant="secundaria"
              className="h-10 flex-1"
              onClick={() => setRespondiendo(true)}
            >
              Responder
            </Button>
          </div>
        )}
      </div>
    </Panel>
  )
}

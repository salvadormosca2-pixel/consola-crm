'use client'

import { AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Panel, PanelHeader } from '@/components/ui/panel'
import {
  PISTA_META,
  PISTAS_POR_ZONA,
  ZONA_META,
  ZONAS,
  type Paso,
  type Zona,
} from '@/lib/pistas'
import { guardarTiempos } from '@/server/actions/seguimientos'

/**
 * El recorrido: cuántos días espera cada escalón.
 *
 * Acá ya no se escribe texto. **El mensaje de cada lead se escribe en Textos**,
 * uno por uno, y lo único que es igual para todos es el reloj: a los dos días
 * se retoma, a los once se cierra la puerta. Eso es lo que se configura acá.
 *
 * La pantalla está partida en dos zonas porque las dos cosas tienen
 * consecuencias distintas: el primer mensaje abre un chat con un desconocido y
 * gasta cupo, y los cuatro escalones del seguimiento salen adentro de una
 * conversación que el lead ya contestó.
 *
 * El control de si el equipo hace los seguimientos está en Equipo: esta
 * pantalla define las reglas, esa mide si se cumplen.
 */

export interface DatosDePistas {
  /** Días de espera por paso, ya resueltos con los defaults del modelo. */
  dias: Record<string, number>
  horasVencimiento: number
  diasAtrasoParaAlerta: number
}

export function PanelDePistas({ datos }: { datos: DatosDePistas }) {
  const reloj = useReloj(datos)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px]">Seguimientos</h1>
        <p className="mt-1 max-w-[760px] text-[13px] leading-relaxed text-texto-2">
          Cada cuántos días le toca el mensaje siguiente a un lead calificado. El texto de cada uno
          lo escribís en{' '}
          <Link href="/textos" className="text-acento underline underline-offset-2">
            Textos
          </Link>
          , lead por lead: acá solo vive el reloj, que sí es igual para todos.
        </p>
      </div>

      {ZONAS.map((zona) => (
        <ZonaDePistas key={zona} zona={zona} reloj={reloj} />
      ))}

      <Generales reloj={reloj} />
    </div>
  )
}

/* ── Los días, todos en un estado ─────────────────────────────────────── */

type Reloj = ReturnType<typeof useReloj>

function useReloj(inicial: DatosDePistas) {
  const router = useRouter()
  const [dias, setDias] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(inicial.dias).map(([k, v]) => [k, String(v)])),
  )
  const [vencimiento, setVencimiento] = React.useState(String(inicial.horasVencimiento))
  const [atraso, setAtraso] = React.useState(String(inicial.diasAtrasoParaAlerta))
  const [pendiente, iniciar] = React.useTransition()

  const cambiado =
    Object.entries(dias).some(([k, v]) => Number(v) !== inicial.dias[k]) ||
    Number(vencimiento) !== inicial.horasVencimiento ||
    Number(atraso) !== inicial.diasAtrasoParaAlerta

  function guardar(): void {
    iniciar(async () => {
      const r = await guardarTiempos({
        horasVencimiento: Number(vencimiento),
        diasAtrasoParaAlerta: Number(atraso),
        diasPorPaso: Object.fromEntries(Object.entries(dias).map(([k, v]) => [k, Number(v)])),
      })
      if (r.ok) {
        toast.success('Guardado')
        router.refresh()
      } else toast.error(r.error ?? 'No se pudo guardar.')
    })
  }

  return {
    dias,
    vencimiento,
    atraso,
    pendiente,
    cambiado,
    guardar,
    ponerDia: (paso: Paso, v: string) => setDias((prev) => ({ ...prev, [String(paso)]: v })),
    ponerVencimiento: setVencimiento,
    ponerAtraso: setAtraso,
  }
}

/**
 * El botón que guarda todos los números de una, esté donde esté el que tocaste.
 *
 * Son una sola configuración aunque estén repartidos en varios paneles: mover
 * dos escalones en la misma pasada tiene que llegar junto, sin que uno pise al
 * otro.
 */
function Guardar({ reloj, className }: { reloj: Reloj; className?: string }) {
  return (
    <Button
      variant="primaria"
      size="sm"
      className={className}
      disabled={reloj.pendiente || !reloj.cambiado}
      onClick={reloj.guardar}
    >
      {reloj.pendiente ? 'Guardando…' : 'Guardar'}
    </Button>
  )
}

/* ── Una zona ─────────────────────────────────────────────────────────── */

function ZonaDePistas({ zona, reloj }: { zona: Zona; reloj: Reloj }) {
  const meta = ZONA_META[zona]

  return (
    <Panel>
      <PanelHeader
        titulo={meta.titulo}
        descripcion={meta.detalle}
        acciones={zona === 'seguimientos' ? <Guardar reloj={reloj} /> : undefined}
      />

      {PISTAS_POR_ZONA[zona].map((pista) => {
        const p = PISTA_META[pista]
        return (
          <div key={pista} className="border-t border-borde first:border-t-0">
            <div className="px-4 py-3">
              <h3 className="text-[14px]">{p.titulo}</h3>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-texto-2">
                {p.cuandoEntra} {p.alTerminar}
              </p>
            </div>

            <ul className="divide-y divide-borde border-t border-borde">
              {p.pasos.map((paso) => (
                <li key={paso.paso} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-[200px] flex-1">
                    <div className="text-[13.5px] text-texto">
                      {p.pasos.length > 1 ? `${paso.orden}. ` : ''}
                      {paso.label}
                    </div>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-texto-2">{paso.angulo}</p>
                  </div>

                  {zona === 'primer_contacto' ? (
                    <span className="text-[12.5px] text-texto-2">Sale en el acto</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={120}
                        aria-label={`Días de espera de ${paso.label}`}
                        value={reloj.dias[String(paso.paso)] ?? String(paso.diasDefault)}
                        onChange={(e) => reloj.ponerDia(paso.paso, e.target.value)}
                        className="w-[84px]"
                      />
                      <span className="text-[12.5px] text-texto-2">días después</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </Panel>
  )
}

/* ── Los dos números que no son de ninguna pista ──────────────────────── */

function Generales({ reloj }: { reloj: Reloj }) {
  return (
    <Panel>
      <PanelHeader
        titulo="Vencimiento y alertas"
        descripcion="No son de ningún escalón en particular: valen para toda la operación."
        acciones={<Guardar reloj={reloj} />}
      />
      <div className="flex flex-wrap items-end gap-3 px-4 py-4">
        <Field label="Un lead vence a las" className="w-[150px]">
          <Input
            type="number"
            min={1}
            max={720}
            value={reloj.vencimiento}
            onChange={(e) => reloj.ponerVencimiento(e.target.value)}
          />
        </Field>
        <span className="pb-2 text-[13px] text-texto-2">horas sin trabajarlo</span>

        <Field label="Me avisás con" className="w-[150px]">
          <Input
            type="number"
            min={1}
            max={30}
            value={reloj.atraso}
            onChange={(e) => reloj.ponerAtraso(e.target.value)}
          />
        </Field>
        <span className="pb-2 text-[13px] text-texto-2">días de atraso</span>
      </div>

      <p className="flex items-start gap-2 border-t border-borde px-4 py-3 text-[12.5px] leading-relaxed text-texto-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-texto-2" aria-hidden />
        <span>
          Si el setter no manda el primer mensaje en {reloj.vencimiento} h, el lead vuelve solo al
          pozo y se le reparte a otro. Un lead ya contactado nunca vence: los seguimientos que le
          queden siguen siendo suyos.
        </span>
      </p>
    </Panel>
  )
}

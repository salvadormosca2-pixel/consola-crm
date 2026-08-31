'use client'

import { AlertTriangle, ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { MensajesDeLaSituacion, Variables } from '@/components/mensaje-editable'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Panel, PanelHeader } from '@/components/ui/panel'
import type { MensajesConfig } from '@/lib/mensajes-config'
import {
  PISTA_META,
  PISTAS_POR_ZONA,
  ZONA_META,
  ZONAS,
  type Paso,
  type PasoDePista,
  type Pista,
  type Zona,
} from '@/lib/pistas'
import { cn } from '@/lib/utils'
import { guardarTiempos } from '@/server/actions/mensajes'
import type { MensajeGuardado } from '@/server/setters/mensajes'

/**
 * Las pistas: por dónde sigue un lead y qué le decimos en cada escalón.
 *
 * La pantalla está partida en tres zonas y no en una lista numerada, porque las
 * tres cosas tienen consecuencias distintas:
 *
 *   · **Primer contacto** no es un seguimiento. Son dos pasos fijos, ninguno
 *     espera, y su texto se escribe en Mensajes.
 *   · **Seguimientos** son las dos pistas reales. Después de la oferta el lead
 *     va a una **o** a la otra, nunca a las dos: por eso son dos escaleras
 *     paralelas y no una sucesión.
 *   · **Reintento** es el único que gasta cupo y arriesga la cuenta, porque el
 *     chat nunca llegó a abrirse. Va marcado aparte y con el cupo del día al
 *     lado, para que agregarle un escalón no parezca gratis.
 *
 * Cada escalón tiene su día **y su texto**, y el texto se abre en la misma
 * fila. Un seguimiento no es un mensaje: es una escalera de varios toques con
 * ángulos distintos, y si los cuatro comparten un texto no hay secuencia, hay
 * un mensaje repetido.
 */

export interface DatosDePistas {
  /** Días de espera por paso, ya resueltos con los defaults del modelo. */
  dias: Record<string, number>
  horasVencimiento: number
  diasAtrasoParaAlerta: number
}

export function PanelDePistas({
  datos,
  mensajes,
  config,
  rubros,
  cupo,
}: {
  datos: DatosDePistas
  mensajes: MensajeGuardado[]
  config: MensajesConfig
  rubros: Array<{ rubro: string; leads: number }>
  cupo: { total: number; restante: number }
}) {
  const reloj = useReloj(datos)
  const [abierto, setAbierto] = React.useState<Paso | null>(null)

  /* Un paso está cargado si tiene el texto general escrito. El de rubro es un
     agregado: sin el general, ese escalón no se puede mandar. */
  const escritos = new Set(
    mensajes.filter((m) => m.rubro === null && m.activo).map((m) => m.paso),
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px]">Seguimientos</h1>
        <p className="mt-1 max-w-[760px] text-[13px] leading-relaxed text-texto-2">
          Por dónde sigue un lead y qué le decimos en cada escalón. Un seguimiento no es un mensaje:
          es una escalera de varios toques, cada uno con su día y su ángulo. Después de la oferta el
          lead va a <strong className="font-medium text-texto">una pista o a la otra</strong>, nunca
          a las dos.
        </p>
      </div>

      {ZONAS.map((zona) => (
        <ZonaDePistas
          key={zona}
          zona={zona}
          reloj={reloj}
          escritos={escritos}
          abierto={abierto}
          abrir={(p) => setAbierto((actual) => (actual === p ? null : p))}
          mensajes={mensajes}
          config={config}
          rubros={rubros}
          cupo={cupo}
        />
      ))}

      <Generales reloj={reloj} />
      <Variables />
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
 * Son una sola configuración aunque estén repartidos en cuatro paneles: mover
 * dos escalones de pistas distintas en la misma pasada tiene que llegar junto,
 * sin que uno pise al otro.
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

function ZonaDePistas({
  zona,
  reloj,
  escritos,
  abierto,
  abrir,
  mensajes,
  config,
  rubros,
  cupo,
}: {
  zona: Zona
  reloj: Reloj
  escritos: Set<Paso>
  abierto: Paso | null
  abrir: (p: Paso) => void
  mensajes: MensajeGuardado[]
  config: MensajesConfig
  rubros: Array<{ rubro: string; leads: number }>
  cupo: { total: number; restante: number }
}) {
  const meta = ZONA_META[zona]
  const esReintento = zona === 'reintento'

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2
            className={cn(
              'text-[11px] font-semibold uppercase tracking-[0.08em]',
              esReintento ? 'text-ambar' : 'text-texto-2',
            )}
          >
            {meta.titulo}
          </h2>
          <p className="mt-0.5 max-w-[760px] text-[12.5px] leading-relaxed text-texto-2">
            {meta.detalle}
          </p>
        </div>

        {/* El cupo, solo acá. Es el número que dice cuánto cuesta un escalón
            más en la única pista que lo paga. */}
        {esReintento ? (
          <span className="dato shrink-0 rounded-[5px] border border-ambar/25 bg-ambar-tenue px-2 py-1 text-[11.5px] text-ambar">
            Cupo de hoy: {cupo.restante} de {cupo.total}
          </span>
        ) : null}
      </div>

      {PISTAS_POR_ZONA[zona].map((pista) => (
        <PistaEditable
          key={pista}
          pista={pista}
          reloj={reloj}
          escritos={escritos}
          abierto={abierto}
          abrir={abrir}
          mensajes={mensajes}
          config={config}
          rubros={rubros}
        />
      ))}
    </section>
  )
}

/* ── Una pista, con su escalera ───────────────────────────────────────── */

function PistaEditable({
  pista,
  reloj,
  escritos,
  abierto,
  abrir,
  mensajes,
  config,
  rubros,
}: {
  pista: Pista
  reloj: Reloj
  escritos: Set<Paso>
  abierto: Paso | null
  abrir: (p: Paso) => void
  mensajes: MensajeGuardado[]
  config: MensajesConfig
  rubros: Array<{ rubro: string; leads: number }>
}) {
  const meta = PISTA_META[pista]
  const faltan = meta.pasos.filter((p) => !escritos.has(p.paso)).length
  const esApertura = pista === 'primer_contacto'

  return (
    <Panel className={meta.zona === 'reintento' ? 'border-ambar/25' : undefined}>
      <PanelHeader
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            {meta.titulo}
            <span className="dato rounded-[4px] border border-borde bg-elevada px-1.5 py-0.5 text-[11px] font-normal text-texto-2">
              {meta.pasos.length} {meta.pasos.length === 1 ? 'paso' : 'pasos'}
            </span>
            {/* Una pista con tres de cuatro escalones cargados está incompleta,
                y sin esto el panel la mostraría como lista. */}
            {faltan > 0 ? (
              <span className="dato rounded-[4px] border border-rojo/40 bg-rojo-tenue px-1.5 py-0.5 text-[11px] font-normal text-rojo">
                falta{faltan === 1 ? '' : 'n'} {faltan}
              </span>
            ) : null}
          </span>
        }
        descripcion={
          <>
            {meta.cuandoEntra}{' '}
            <span className="text-texto-2/80">Al terminar: {meta.alTerminar.toLowerCase()}</span>
          </>
        }
        acciones={esApertura ? null : <Guardar reloj={reloj} />}
      />

      <ol className="divide-y divide-borde/60">
        {meta.pasos.map((p) => (
          <Escalon
            key={p.paso}
            paso={p}
            pista={pista}
            reloj={reloj}
            escrito={escritos.has(p.paso)}
            abierto={abierto === p.paso}
            abrir={() => abrir(p.paso)}
            mensajes={mensajes}
            config={config}
            rubros={rubros}
          />
        ))}
      </ol>
    </Panel>
  )
}

/* ── Un escalón: su día, y su texto adentro ───────────────────────────── */

function Escalon({
  paso,
  pista,
  reloj,
  escrito,
  abierto,
  abrir,
  mensajes,
  config,
  rubros,
}: {
  paso: PasoDePista
  pista: Pista
  reloj: Reloj
  escrito: boolean
  abierto: boolean
  abrir: () => void
  mensajes: MensajeGuardado[]
  config: MensajesConfig
  rubros: Array<{ rubro: string; leads: number }>
}) {
  const esApertura = pista === 'primer_contacto'

  return (
    <li>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5">
        <div className="w-[132px] shrink-0">
          {esApertura ? (
            <span className="dato text-[12px] text-acento">en el acto</span>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] text-texto-2">+</span>
                <Input
                  type="number"
                  min={0}
                  max={120}
                  aria-label={`Días de "${paso.label}"`}
                  className="w-[64px]"
                  value={reloj.dias[String(paso.paso)] ?? ''}
                  onChange={(e) => reloj.ponerDia(paso.paso, e.target.value)}
                />
                <span className="text-[12px] text-texto-2">días</span>
              </div>
              {/* Lo que más confunde, dicho donde se toca el número. */}
              <p className="mt-0.5 text-[11px] leading-tight text-texto-2">
                desde el último movimiento
              </p>
            </>
          )}
        </div>

        <div className="min-w-[240px] flex-1">
          <p className="text-[13px] font-medium text-texto">
            <span className="dato mr-1.5 text-texto-2">{paso.orden}.</span>
            {paso.label}
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-texto-2">{paso.angulo}</p>
        </div>

        {/*
          El texto de la apertura vive en Mensajes: no es un seguimiento y no
          depende de ningún día. Los de las pistas se abren acá mismo.

          El botón lo dice con todas las letras y lleva una flecha. Antes decía
          "Ver el mensaje", igual que el de los escalones que sí se editan acá,
          y eso hacía parecer que la entrada y la oferta se cargaban en las dos
          pantallas — dos lugares para el mismo texto, sin saber cuál manda.
        */}
        {esApertura ? (
          <Link
            href={`/mensajes?situacion=${paso.paso}`}
            className={cn(
              'flex h-7.5 shrink-0 items-center gap-1 rounded-[5px] border px-2.5 text-[12px]',
              escrito
                ? 'border-borde bg-superficie text-texto-2 hover:text-texto'
                : 'border-rojo/40 bg-rojo-tenue text-rojo',
            )}
          >
            {escrito ? 'Ver en Mensajes' : 'Escribirlo en Mensajes'}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : (
          <button
            type="button"
            onClick={abrir}
            aria-expanded={abierto}
            className={cn(
              'flex h-7.5 shrink-0 items-center rounded-[5px] border px-2.5 text-[12px]',
              abierto
                ? 'border-acento/40 bg-acento-tenue text-acento'
                : escrito
                  ? 'border-borde bg-elevada text-texto-2 hover:text-texto'
                  : 'border-rojo/40 bg-rojo-tenue text-rojo',
            )}
          >
            {abierto ? 'Cerrar' : escrito ? 'Ver el mensaje' : 'Falta el mensaje'}
          </button>
        )}
      </div>

      {abierto && !esApertura ? (
        <div className="space-y-3 border-t border-borde/60 bg-elevada/40 px-3 py-3">
          <MensajesDeLaSituacion
            paso={paso.paso}
            mensajes={mensajes}
            config={config}
            rubros={rubros}
          />
        </div>
      ) : null}
    </li>
  )
}

/* ── Vencimiento y alertas ────────────────────────────────────────────── */

function Generales({ reloj }: { reloj: Reloj }) {
  return (
    <Panel>
      <PanelHeader
        titulo="Vencimiento y alertas"
        descripcion="No son de ninguna pista en particular: valen para toda la operación."
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
          Si el setter no manda la entrada en {reloj.vencimiento} h, el lead vuelve solo al pozo y se
          le reparte a otro. Un lead ya contactado nunca vence: los seguimientos que le quedan siguen
          siendo suyos. Y si la conversación sigue viva, el seguimiento se cancela desde la bandeja.
        </span>
      </p>
    </Panel>
  )
}

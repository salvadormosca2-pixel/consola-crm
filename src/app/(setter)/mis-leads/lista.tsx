'use client'

import { ExternalLink, Search, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { AbrirInstagram } from '@/components/setter/abrir-instagram'
import { AccionDeLead, etapaDe } from '@/components/setter/acciones-lead'
import { Input } from '@/components/ui/input'
import { Chip, Panel, type Tono } from '@/components/ui/panel'
import { INTERES_META } from '@/db/enums'
import { copiarAlPortapapeles } from '@/lib/copiar'
import { formatCorto, haceCuanto } from '@/lib/tz'
import { PESTANA_META, PESTANAS, type Pestana } from '@/lib/setters-vistas'
import { cn } from '@/lib/utils'
import type { MisLeads } from '@/server/setters/leads'

/**
 * Todos sus leads, ordenados por el recorrido que hacen.
 *
 * Las pestañas son las etapas, en orden, y **cada fila tiene un solo botón**:
 * el de la acción que corresponde ahí. Al tocarlo el lead se mueve a la
 * pestaña siguiente y su etiqueta cambia sola. Antes cada fila mostraba todos
 * los botones a la vez y no se entendía cuál tocar.
 *
 * Lo que más se usa es el buscador: le contestó alguien de hace tres días, lo
 * busca por el nombre del negocio y lo marca.
 */
export function Lista({
  datos,
  pestana,
  busqueda,
}: {
  datos: MisLeads
  pestana: Pestana
  busqueda: string
}) {
  const router = useRouter()
  const [texto, setTexto] = React.useState(busqueda)

  const irA = React.useCallback(
    (p: Pestana, q: string) => {
      const params = new URLSearchParams()
      if (p !== 'por_contactar') params.set('ver', p)
      if (q.trim()) params.set('q', q.trim())
      // Las rutas tipadas no aceptan una plantilla con parámetros variables.
      router.replace(`/mis-leads${params.size > 0 ? `?${params}` : ''}` as never)
    },
    [router],
  )

  // Se navega con un respiro: escribir en el celular dispara una consulta por
  // letra si no se espera.
  React.useEffect(() => {
    if (texto === busqueda) return
    const id = setTimeout(() => irA(pestana, texto), 350)
    return () => clearTimeout(id)
  }, [texto, busqueda, pestana, irA])

  const etiqueta = PESTANA_META[pestana].etiqueta
  const tono = TONO_DE_PESTANA[pestana]

  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-texto-2"
          aria-hidden
        />
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar negocio o usuario"
          aria-label="Buscar entre mis leads"
          className="h-11 pl-8 pr-9 text-[16px]"
        />
        {texto ? (
          <button
            onClick={() => setTexto('')}
            aria-label="Limpiar"
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-texto-2"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-0.5">
        <Contador valor={datos.totales.contactados} rotulo="contactados" />
        <Contador valor={datos.totales.respondieron} rotulo="respondieron" />
        <Contador valor={datos.totales.interesados} rotulo="les interesa" />
        <Contador valor={datos.totales.reuniones} rotulo="reuniones" />
      </div>

      {/* Las etapas, en el orden en que las recorre un lead. */}
      <div className="-mx-3 flex gap-1 overflow-x-auto px-3 pb-1">
        {PESTANAS.map((p) => (
          <button
            key={p}
            onClick={() => irA(p, texto)}
            aria-current={p === pestana ? 'page' : undefined}
            className={cn(
              'flex h-9 shrink-0 items-center gap-1.5 rounded-[5px] border px-2.5 text-[12.5px] font-medium',
              p === pestana
                ? 'border-acento/40 bg-acento-tenue text-acento'
                : 'border-borde bg-elevada text-texto-2',
            )}
          >
            {PESTANA_META[p].label}
            <span className="dato text-[11px] opacity-70">{datos.conteos[p]}</span>
          </button>
        ))}
      </div>

      {datos.filas.length === 0 ? (
        <Panel className="px-4 py-8 text-center">
          <p className="text-[13.5px] leading-relaxed text-texto-2">
            {busqueda
              ? `No encontré ningún lead tuyo que diga "${busqueda}".`
              : PESTANA_META[pestana].vacio}
          </p>
        </Panel>
      ) : (
        <div className="space-y-2">
          {datos.filas.map((f) => (
            <Panel key={f.assignmentId} className={cn(f.porVencer && 'border-ambar/45')}>
              <div className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] leading-tight text-texto">{f.businessName}</p>
                    <p className="dato mt-0.5 text-[12px] text-texto-2">@{f.igUsername}</p>
                  </div>

                  {/*
                    La etiqueta dice qué le pasó a este lead, sin tener que
                    deducirlo del estado interno. Cuando ya contestó la oferta
                    manda el sí o el no, que es lo único que importa ahí.
                  */}
                  {f.interes ? (
                    <Chip tono={INTERES_META[f.interes].tone}>{INTERES_META[f.interes].label}</Chip>
                  ) : (
                    <Chip tono={tono}>{etiqueta}</Chip>
                  )}
                </div>

                <p className="mt-1 text-[12px] text-texto-2">
                  {f.reunionAt
                    ? `Reunión el ${formatCorto(f.reunionAt)}`
                    : f.respondidoAt
                      ? `Contestó ${haceCuanto(f.respondidoAt)}`
                      : f.contactadoAt
                        ? `Le escribiste ${haceCuanto(f.contactadoAt)}`
                        : `Te tocó ${haceCuanto(f.asignadoAt)}`}
                </p>

                {f.porVencer ? (
                  <p className="mt-1 text-[12px] text-ambar">
                    {f.horasRestantes === 0
                      ? 'Vence en menos de una hora'
                      : `Vence en ${f.horasRestantes} h`}
                  </p>
                ) : null}

                <AbrirChat lead={f} />

                {/* Un solo botón, el de esta etapa. Puede no haber ninguno. */}
                <AccionDeLead
                  assignmentId={f.assignmentId}
                  negocio={f.businessName}
                  etapa={etapaDe({ estado: f.estado, respondioA: f.respondioA })}
                  onHecho={() => router.refresh()}
                  className="mt-2"
                />
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Abrir el chat, copiando lo que haya que mandar.
 *
 * Era un enlace pelado y esa era la mitad del problema: el setter tocaba,
 * llegaba a Instagram y no tenía nada que pegar. Ahora copia el mensaje que le
 * toca a ese lead —el mismo que le daría la cola— **dentro del toque**, antes
 * de irse de la pantalla, que es la única forma de que el navegador lo permita.
 *
 * Si al lead no le toca ningún mensaje —ya recibió todo, o está esperando— no
 * copia nada y lo dice. Es preferible a pegarle un guion que no corresponde.
 */
function AbrirChat({ lead }: { lead: MisLeads['filas'][number] }) {
  function copiar(): void {
    if (!lead.mensaje) return
    void copiarAlPortapapeles(lead.mensaje).then((ok) => {
      if (ok) toast.success('Mensaje copiado — pegá con mantener presionado')
      else toast.error('No se pudo copiar. Copiá el mensaje a mano desde la cola.')
    })
  }

  return (
    <AbrirInstagram
      link={lead.linkDirecto}
      onAbrir={copiar}
      className="mt-2.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-[5px] border border-borde bg-elevada text-[12.5px] font-medium text-texto"
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      {lead.mensaje ? 'Copiar y abrir chat' : 'Abrir chat'}
    </AbrirInstagram>
  )
}

/** Cada etapa tiene su color: gris al principio, verde cuando contestaron. */
const TONO_DE_PESTANA: Record<Pestana, Tono> = {
  por_contactar: 'neutral',
  contactados: 'neutral',
  respondio_primero: 'positivo',
  oferta_enviada: 'activo',
  respondio_oferta: 'positivo',
  reuniones: 'positivo',
}

function Contador({ valor, rotulo }: { valor: number; rotulo: string }) {
  return (
    <span className="text-[12px] text-texto-2">
      <span className="dato text-[15px] text-texto">{valor}</span> {rotulo}
    </span>
  )
}

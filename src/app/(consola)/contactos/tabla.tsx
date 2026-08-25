'use client'

import { useVirtualizer } from '@tanstack/react-virtual'
import { toast } from 'sonner'
import { Instagram, MessageCircle, Search, X } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Chip, Panel } from '@/components/ui/panel'
import { STAGE_META, type ContactStage } from '@/db/enums'
import { formatearTelefono } from '@/lib/phone-ar'
import { haceCuanto } from '@/lib/tz'
import { cn } from '@/lib/utils'
import type { FilaContacto } from '@/server/contacts'
import { clasificar } from '@/server/actions/contacts'
import { BotonContesto } from '@/components/boton-contesto'

/** Alto de fila en píxeles. Fijo, que es lo que permite virtualizar. */
const ALTO = 34

interface Opciones {
  rubros: string[]
  ciudades: string[]
}

export function TablaContactos({
  contactos,
  opciones,
}: {
  contactos: FilaContacto[]
  opciones: Opciones
}) {
  const [busqueda, setBusqueda] = React.useState('')
  const [etapa, setEtapa] = React.useState('')
  const [canal, setCanal] = React.useState('')
  const [rubro, setRubro] = React.useState('')
  const [ciudad, setCiudad] = React.useState('')
  const [respondieron, setRespondieron] = React.useState('')
  const [seleccionado, setSeleccionado] = React.useState<FilaContacto | null>(null)

  /*
   * El filtrado pasa en el cliente: con 1.000 contactos el payload es chico y
   * así los filtros responden al instante en vez de ir y volver al servidor
   * con cada tecla.
   */
  const filtrados = React.useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return contactos.filter((c) => {
      if (etapa && c.stage !== etapa) return false
      if (canal === 'whatsapp' && !c.phoneE164) return false
      if (canal === 'instagram' && !c.igUsername) return false
      if (rubro && c.niche !== rubro) return false
      if (ciudad && c.city !== ciudad) return false
      if (respondieron === 'si' && c.receivedCount === 0) return false
      if (respondieron === 'no' && c.receivedCount > 0) return false
      if (q) {
        const heno = `${c.businessName} ${c.contactName ?? ''} ${c.phoneE164 ?? ''} ${c.igUsername ?? ''}`
        if (!heno.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [contactos, busqueda, etapa, canal, rubro, ciudad, respondieron])

  const contenedor = React.useRef<HTMLDivElement>(null)
  const virtual = useVirtualizer({
    count: filtrados.length,
    getScrollElement: () => contenedor.current,
    estimateSize: () => ALTO,
    overscan: 12,
  })

  const hayFiltros = Boolean(busqueda || etapa || canal || rubro || ciudad || respondieron)

  function limpiar() {
    setBusqueda('')
    setEtapa('')
    setCanal('')
    setRubro('')
    setCiudad('')
    setRespondieron('')
  }

  return (
    <div className="space-y-2">
      {/* ── Filtros ──────────────────────────────────────────────────── */}
      <Panel className="flex flex-wrap items-center gap-1.5 p-2">
        <div className="relative min-w-[200px] flex-1">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-texto-2"
            aria-hidden
          />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por negocio, nombre, teléfono o usuario"
            className="pl-7"
            aria-label="Buscar contactos"
          />
        </div>

        <Selector valor={etapa} onCambio={setEtapa} etiqueta="Etapa">
          {(Object.keys(STAGE_META) as ContactStage[]).map((s) => (
            <option key={s} value={s}>
              {STAGE_META[s].label}
            </option>
          ))}
        </Selector>

        <Selector valor={canal} onCambio={setCanal} etiqueta="Canal">
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram</option>
        </Selector>

        <Selector valor={rubro} onCambio={setRubro} etiqueta="Rubro">
          {opciones.rubros.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Selector>

        <Selector valor={ciudad} onCambio={setCiudad} etiqueta="Ciudad">
          {opciones.ciudades.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Selector>


        <Selector valor={respondieron} onCambio={setRespondieron} etiqueta="Respuesta">
          <option value="si">Contestaron</option>
          <option value="no">Sin contestar</option>
        </Selector>

        {hayFiltros ? (
          <Button variant="fantasma" size="sm" onClick={limpiar}>
            <X aria-hidden />
            Limpiar
          </Button>
        ) : null}

        <span className="dato ml-auto whitespace-nowrap text-[11.5px] text-texto-2">
          {filtrados.length.toLocaleString('es-AR')}
          {filtrados.length !== contactos.length ? ` de ${contactos.length.toLocaleString('es-AR')}` : ''}
        </span>
      </Panel>

      {/* ── Tabla ────────────────────────────────────────────────────── */}
      <Panel className="overflow-hidden">
        <div className="hidden min-w-[1100px] border-b border-borde bg-elevada/50 lg:grid" style={COLUMNAS}>
          <Encabezado>Negocio</Encabezado>
          <Encabezado>Contacto</Encabezado>
          <Encabezado className="text-center">Canales</Encabezado>
          <Encabezado>Rubro</Encabezado>
          <Encabezado>Etapa</Encabezado>
          <Encabezado className="text-right">Score</Encabezado>
          <Encabezado className="text-right">Env.</Encabezado>
          <Encabezado className="text-right">Rec.</Encabezado>
          <Encabezado>Último</Encabezado>
        </div>

        {filtrados.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-texto-2">
            Ningún contacto coincide con esos filtros.{' '}
            <button onClick={limpiar} className="text-acento underline underline-offset-2">
              Limpiar filtros
            </button>
          </p>
        ) : (
          <div
            ref={contenedor}
            className="max-h-[calc(100dvh-320px)] min-h-[300px] overflow-auto"
            tabIndex={0}
            aria-label="Lista de contactos"
          >
            <div className="relative min-w-[1100px]" style={{ height: virtual.getTotalSize() }}>
              {virtual.getVirtualItems().map((item) => {
                const c = filtrados[item.index]!
                return (
                  <button
                    key={c.id}
                    onClick={() => setSeleccionado(c)}
                    className={cn(
                      'absolute left-0 top-0 grid w-full items-center border-b border-borde/50 text-left',
                      'text-[12.5px] transition-colors duration-150 hover:bg-elevada/50',
                      seleccionado?.id === c.id && 'bg-elevada',
                    )}
                    style={{ ...COLUMNAS, height: ALTO, transform: `translateY(${item.start}px)` }}
                  >
                    <Celda className="font-medium text-texto">{c.businessName}</Celda>
                    <Celda className="text-texto-2">{c.contactName ?? '—'}</Celda>
                    <Celda className="flex items-center justify-center gap-1">
                      <MessageCircle
                        className={cn('h-3 w-3', c.phoneE164 ? 'text-verde' : 'text-borde')}
                        aria-label={c.phoneE164 ? 'Tiene WhatsApp' : 'Sin WhatsApp'}
                      />
                      <Instagram
                        className={cn('h-3 w-3', c.igUsername ? 'text-ambar' : 'text-borde')}
                        aria-label={c.igUsername ? 'Tiene Instagram' : 'Sin Instagram'}
                      />
                    </Celda>
                    <Celda className="text-texto-2">{c.niche ?? '—'}</Celda>
                    <Celda>
                      <Chip tono={STAGE_META[c.stage].tone}>{STAGE_META[c.stage].label}</Chip>
                    </Celda>
                    <Celda className="dato justify-end text-right">
                      <span className={c.score >= 60 ? 'text-verde' : c.score === 0 ? 'text-texto-2' : ''}>
                        {c.score}
                      </span>
                    </Celda>
                    <Celda className="dato justify-end text-right text-texto-2">{c.sentCount}</Celda>
                    <Celda className="dato justify-end text-right">
                      <span className={c.receivedCount > 0 ? 'text-verde' : 'text-texto-2'}>
                        {c.receivedCount}
                      </span>
                    </Celda>
                    <Celda className="text-texto-2">
                      {haceCuanto(c.lastInboundAt ?? c.lastOutboundAt)}
                    </Celda>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </Panel>

      {seleccionado ? (
        <Ficha contacto={seleccionado} onCerrar={() => setSeleccionado(null)} />
      ) : null}
    </div>
  )
}

const COLUMNAS: React.CSSProperties = {
  gridTemplateColumns:
    'minmax(160px,2fr) minmax(120px,1.2fr) 66px minmax(96px,1fr) 130px 54px 44px 44px 92px 68px',
}

function Encabezado({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rotulo truncate px-2.5 py-1.5', className)}>{children}</div>
}

function Celda({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('truncate px-2.5', className)}>{children}</div>
}

function Selector({
  valor,
  onCambio,
  etiqueta,
  children,
}: {
  valor: string
  onCambio: (v: string) => void
  etiqueta: string
  children: React.ReactNode
}) {
  return (
    <select
      value={valor}
      onChange={(e) => onCambio(e.target.value)}
      aria-label={etiqueta}
      className={cn(
        'h-7.5 rounded-[4px] border bg-fondo px-1.5 text-[12px] transition-colors duration-150',
        'focus:border-acento focus:outline-none',
        valor ? 'border-ambar/45 bg-ambar-tenue text-ambar' : 'border-borde text-texto-2',
      )}
    >
      <option value="">{etiqueta}</option>
      {children}
    </select>
  )
}

/** Ficha lateral. La línea de tiempo completa llega con el motor de envío. */
function Ficha({ contacto, onCerrar }: { contacto: FilaContacto; onCerrar: () => void }) {
  const [pendiente, iniciar] = React.useTransition()

  React.useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onCerrar])

  return (
    <aside
      className="fixed right-0 top-11 z-30 h-[calc(100dvh-2.75rem)] w-[min(360px,100vw)] overflow-y-auto border-l border-borde bg-superficie"
      aria-label={`Ficha de ${contacto.businessName}`}
    >
      <div className="flex items-start justify-between gap-2 border-b border-borde px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-[15px]">{contacto.businessName}</h2>
          <p className="mt-0.5 text-[12px] text-texto-2">{contacto.contactName ?? 'Sin nombre de contacto'}</p>
        </div>
        <Button variant="fantasma" size="iconoSm" onClick={onCerrar} aria-label="Cerrar ficha">
          <X aria-hidden />
        </Button>
      </div>

      <dl className="divide-y divide-borde/60">
        <Dato rotulo="Etapa">
          <Chip tono={STAGE_META[contacto.stage].tone}>{STAGE_META[contacto.stage].label}</Chip>
        </Dato>
        <Dato rotulo="Score">
          <span className="dato">{contacto.score}</span>
        </Dato>
        <Dato rotulo="WhatsApp">
          <span className="dato">{formatearTelefono(contacto.phoneE164)}</span>
        </Dato>
        <Dato rotulo="Instagram">
          <span className="dato">{contacto.igUsername ? `@${contacto.igUsername}` : '—'}</span>
        </Dato>
        <Dato rotulo="Rubro">{contacto.niche ?? '—'}</Dato>
        <Dato rotulo="Ciudad">{contacto.city ?? '—'}</Dato>
        <Dato rotulo="Qué compró">{contacto.bought ?? '—'}</Dato>
        <Dato rotulo="Mensajes">
          <span className="dato">
            {contacto.sentCount} enviados · {contacto.receivedCount} recibidos
          </span>
        </Dato>
        <Dato rotulo="Último movimiento">
          {haceCuanto(contacto.lastInboundAt ?? contacto.lastOutboundAt)}
        </Dato>
        <Dato rotulo="Próximo seguimiento">
          {contacto.nextFollowupAt ? haceCuanto(contacto.nextFollowupAt) : '—'}
        </Dato>
      </dl>


      {/* Clasificar sin salir de la lista: es la acción que más se repite. */}
      <div className="border-t border-borde p-3">
        <div className="rotulo mb-1.5">Clasificar</div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ['interesado', 'Interesado', 'positiva'],
              ['reunion_agendada', 'Reunión', 'positiva'],
              ['respondido', 'Respondió', 'secundaria'],
              ['sin_respuesta', 'No ahora', 'secundaria'],
              ['perdido', 'No', 'destructiva'],
              ['no_contactar', 'No contactar', 'destructiva'],
            ] as const
          ).map(([etapa, label, variante]) => (
            <Button
              key={etapa}
              variant={variante}
              size="sm"
              disabled={pendiente || contacto.stage === etapa}
              onClick={() =>
                iniciar(async () => {
                  const r = await clasificar(contacto.id, etapa)
                  if (r.ok) {
                    toast.success(`${contacto.businessName}: ${label.toLowerCase()}`)
                    onCerrar()
                  } else toast.error(r.error ?? 'No se pudo clasificar.')
                })
              }
            >
              {label}
            </Button>
          ))}
        </div>

        {contacto.receivedCount === 0 ? (
          <div className="mt-2 border-t border-borde/60 pt-2">
            <BotonContesto
              contactId={contacto.id}
              nombre={contacto.businessName}
              onHecho={onCerrar}
            />
            <p className="mt-1 text-[11px] text-texto-2">
              Marca que te escribió y corta la secuencia pendiente.
            </p>
          </div>
        ) : null}
      </div>

      <p className="border-t border-borde px-3 py-3 text-[11px] leading-relaxed text-texto-2">
        La línea de tiempo con cada mensaje y cada cambio de etapa se arma junto con el resto del
        motor de envío.
      </p>
    </aside>
  )
}

function Dato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-1.5">
      <dt className="rotulo shrink-0">{rotulo}</dt>
      <dd className="min-w-0 truncate text-right text-[12.5px]">{children}</dd>
    </div>
  )
}

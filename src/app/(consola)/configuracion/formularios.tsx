'use client'

import { CheckCircle2, Plug, XCircle } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Chip, Panel, PanelHeader } from '@/components/ui/panel'
import { cn } from '@/lib/utils'
import type { FilaCuenta } from '@/server/accounts'
import {
  guardarChatwoot,
  guardarEvolution,
  mapearCuenta,
  probarChatwoot,
  probarEvolution,
  type ResultadoPrueba,
} from '@/server/actions/integraciones'

type Item = { id: string; label: string; detalle: string; conectada: boolean }

/**
 * Configuración de las integraciones.
 *
 * El botón de probar trae la lista real de inboxes o instancias. Sin esa lista
 * no se puede mapear nada, así que probar no es un lujo: es el paso previo
 * obligatorio.
 */
export function FormularioChatwoot({
  inicial,
  onInboxes,
}: {
  inicial: { baseUrl: string; accountId: number; tokenEnmascarado: string } | null
  onInboxes: (items: Item[]) => void
}) {
  const [items, setItems] = React.useState<Item[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [pendiente, iniciar] = React.useTransition()
  const ref = React.useRef<HTMLFormElement>(null)

  function correr(fn: (fd: FormData) => Promise<ResultadoPrueba>) {
    const fd = new FormData(ref.current!)
    iniciar(async () => {
      setError(null)
      const r = await fn(fd)
      if (r.ok) {
        setItems(r.items)
        onInboxes(r.items)
        toast.success(`Conectó — ${r.items.length} inboxes`)
      } else {
        setItems([])
        setError(r.error)
      }
    })
  }

  return (
    <Panel>
      <PanelHeader
        titulo="Chatwoot"
        descripcion="La bandeja unificada. Recomendado: las respuestas entran solas por webhook."
        acciones={
          inicial ? <Chip tono="positivo">configurado</Chip> : <Chip>sin configurar</Chip>
        }
      />

      <form ref={ref} className="space-y-2 p-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
          <Field label="URL de tu Chatwoot" hint="Sin barra al final">
            <Input name="baseUrl" defaultValue={inicial?.baseUrl ?? ''} placeholder="https://app.chatwoot.com" />
          </Field>
          <Field label="Id de cuenta" hint="Sale en la URL">
            <Input name="accountId" type="number" min={1} defaultValue={inicial?.accountId ?? ''} placeholder="1" className="dato" />
          </Field>
        </div>

        <Field
          label="Token de la API"
          hint={
            inicial
              ? `Guardado: ${inicial.tokenEnmascarado}. Escribí uno nuevo solo si querés cambiarlo.`
              : 'Perfil → Configuración → Access Token'
          }
        >
          <Input name="token" type="password" placeholder="cw_pat_…" className="dato" autoComplete="off" />
        </Field>

        <Acciones
          pendiente={pendiente}
          error={error}
          onProbar={() => correr(probarChatwoot)}
          onGuardar={() =>
            iniciar(async () => {
              const r = await guardarChatwoot(new FormData(ref.current!))
              if (r.ok) toast.success('Chatwoot guardado — ya podés mapear los inboxes')
              else toast.error(r.error ?? 'No se pudo guardar.')
            })
          }
        />

        {items.length > 0 ? <Lista titulo="Inboxes encontrados" items={items} /> : null}
      </form>
    </Panel>
  )
}

export function FormularioEvolution({
  inicial,
  onInstancias,
}: {
  inicial: { baseUrl: string; apiKeyEnmascarada: string } | null
  onInstancias: (items: Item[]) => void
}) {
  const [items, setItems] = React.useState<Item[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [pendiente, iniciar] = React.useTransition()
  const ref = React.useRef<HTMLFormElement>(null)

  return (
    <Panel>
      <PanelHeader
        titulo="Evolution API"
        descripcion="Envío directo, sin Chatwoot. Manda igual, pero las respuestas hay que marcarlas a mano."
        acciones={inicial ? <Chip tono="positivo">configurado</Chip> : <Chip>sin configurar</Chip>}
      />

      <form ref={ref} className="space-y-2 p-3">
        <Field label="URL de Evolution" hint="Ej: https://evolution.midominio.com">
          <Input name="baseUrl" defaultValue={inicial?.baseUrl ?? ''} placeholder="https://evolution.midominio.com" />
        </Field>

        <Field
          label="API key global"
          hint={
            inicial
              ? `Guardada: ${inicial.apiKeyEnmascarada}. Escribí una nueva solo si querés cambiarla.`
              : 'La AUTHENTICATION_API_KEY de tu instalación'
          }
        >
          <Input name="apiKey" type="password" className="dato" autoComplete="off" />
        </Field>

        <Acciones
          pendiente={pendiente}
          error={error}
          onProbar={() => {
            const fd = new FormData(ref.current!)
            iniciar(async () => {
              setError(null)
              const r = await probarEvolution(fd)
              if (r.ok) {
                setItems(r.items)
                onInstancias(r.items)
                toast.success(`Conectó — ${r.items.length} instancias`)
              } else {
                setItems([])
                setError(r.error)
              }
            })
          }}
          onGuardar={() =>
            iniciar(async () => {
              const r = await guardarEvolution(new FormData(ref.current!))
              if (r.ok) toast.success('Evolution guardado')
              else toast.error(r.error ?? 'No se pudo guardar.')
            })
          }
        />

        {items.length > 0 ? <Lista titulo="Instancias encontradas" items={items} /> : null}
      </form>
    </Panel>
  )
}

function Acciones({
  pendiente,
  error,
  onProbar,
  onGuardar,
}: {
  pendiente: boolean
  error: string | null
  onProbar: () => void
  onGuardar: () => void
}) {
  return (
    <>
      {error ? (
        <p role="alert" className="rounded-[4px] border border-rojo/35 bg-rojo/10 px-2 py-1.5 text-[11.5px] text-rojo">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-1.5 border-t border-borde pt-2.5">
        <Button type="button" variant="secundaria" onClick={onProbar} disabled={pendiente}>
          <Plug aria-hidden />
          {pendiente ? 'Probando…' : 'Probar conexión'}
        </Button>
        <Button type="button" variant="primaria" onClick={onGuardar} disabled={pendiente}>
          Guardar
        </Button>
      </div>
    </>
  )
}

function Lista({ titulo, items }: { titulo: string; items: Item[] }) {
  return (
    <div className="rounded-[5px] border border-borde bg-fondo p-2">
      <div className="rotulo mb-1">{titulo}</div>
      <ul className="space-y-0.5">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-1.5 text-[12px]">
            {i.conectada ? (
              <CheckCircle2 className="h-3 w-3 shrink-0 text-verde" aria-hidden />
            ) : (
              <XCircle className="h-3 w-3 shrink-0 text-ambar" aria-hidden />
            )}
            <span className="dato text-texto-2">{i.id}</span>
            <span className="truncate text-texto">{i.label}</span>
            <span className="ml-auto shrink-0 text-[11px] text-texto-2">{i.detalle}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Mapeo cuenta ↔ inbox / instancia.
 *
 * Es el paso que hace que el Despachador diga "Enviar" en vez de "Abrir
 * WhatsApp": sin saber por qué inbox sale cada número, el servidor no puede
 * mandar solo.
 */
export function MapeoDeCuentas({
  cuentas,
  inboxes,
  instancias,
}: {
  cuentas: FilaCuenta[]
  inboxes: Item[]
  instancias: Item[]
}) {
  const [pendiente, iniciar] = React.useTransition()
  const soloWa = cuentas.filter((c) => c.channel === 'whatsapp')

  if (soloWa.length === 0) {
    return (
      <Panel className="px-4 py-8 text-center">
        <p className="text-[12.5px] text-texto-2">
          Cargá primero tus cuentas de WhatsApp para poder mapearlas.
        </p>
      </Panel>
    )
  }

  return (
    <Panel>
      <PanelHeader
        titulo="Qué número usa cada cosa"
        descripcion={
          inboxes.length === 0 && instancias.length === 0
            ? 'Probá la conexión de arriba para traer la lista real y poder elegir.'
            : 'Cada número tiene que apuntar a su inbox o instancia. Sin esto, no puede mandar solo.'
        }
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-borde bg-elevada/40 text-left">
              <th className="rotulo px-2.5 py-1.5">Cuenta</th>
              <th className="rotulo px-2.5 py-1.5">Inbox de Chatwoot</th>
              <th className="rotulo px-2.5 py-1.5">Instancia de Evolution</th>
              <th className="rotulo px-2.5 py-1.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {soloWa.map((c) => (
              <FilaMapeo
                key={c.id}
                cuenta={c}
                inboxes={inboxes}
                instancias={instancias}
                pendiente={pendiente}
                iniciar={iniciar}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function FilaMapeo({
  cuenta,
  inboxes,
  instancias,
  pendiente,
  iniciar,
}: {
  cuenta: FilaCuenta
  inboxes: Item[]
  instancias: Item[]
  pendiente: boolean
  iniciar: React.TransitionStartFunction
}) {
  const [inbox, setInbox] = React.useState<string>('')
  const [instancia, setInstancia] = React.useState<string>(cuenta.instanceName ?? '')

  function guardar(nuevoInbox: string, nuevaInstancia: string) {
    iniciar(async () => {
      const r = await mapearCuenta(
        cuenta.id,
        nuevoInbox ? Number(nuevoInbox) : null,
        nuevaInstancia || null,
      )
      if (r.ok) toast.success(`${cuenta.code} mapeada`)
      else toast.error(r.error ?? 'No se pudo mapear.')
    })
  }

  const listo = Boolean(inbox || instancia)

  return (
    <tr className="border-b border-borde/50 last:border-b-0">
      <td className="px-2.5 py-1.5">
        <span className="dato text-texto-2">{cuenta.code}</span>{' '}
        <span className="text-texto">{cuenta.label}</span>
      </td>
      <td className="px-2.5 py-1.5">
        <Selector
          valor={inbox}
          disabled={pendiente || inboxes.length === 0}
          vacio={inboxes.length === 0 ? 'probá la conexión' : 'sin asignar'}
          opciones={inboxes.map((i) => [i.id, `${i.id} · ${i.label}`])}
          onCambio={(v) => {
            setInbox(v)
            guardar(v, instancia)
          }}
        />
      </td>
      <td className="px-2.5 py-1.5">
        <Selector
          valor={instancia}
          disabled={pendiente || instancias.length === 0}
          vacio={instancias.length === 0 ? 'probá la conexión' : 'sin asignar'}
          opciones={instancias.map((i) => [i.id, `${i.label}${i.conectada ? '' : ' (sin conectar)'}`])}
          onCambio={(v) => {
            setInstancia(v)
            guardar(inbox, v)
          }}
        />
      </td>
      <td className="px-2.5 py-1.5">
        {listo ? (
          <Chip tono="positivo">manda solo</Chip>
        ) : (
          <Chip>por link</Chip>
        )}
      </td>
    </tr>
  )
}

function Selector({
  valor,
  onCambio,
  opciones,
  vacio,
  disabled,
}: {
  valor: string
  onCambio: (v: string) => void
  opciones: Array<[string, string]>
  vacio: string
  disabled: boolean
}) {
  return (
    <select
      value={valor}
      disabled={disabled}
      onChange={(e) => onCambio(e.target.value)}
      className={cn(
        'h-6 w-full rounded-[4px] border bg-fondo px-1 text-[11.5px]',
        'focus:border-ambar focus:outline-none disabled:opacity-50',
        valor ? 'border-ambar/40 text-ambar' : 'border-borde text-texto-2',
      )}
    >
      <option value="">{vacio}</option>
      {opciones.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  )
}

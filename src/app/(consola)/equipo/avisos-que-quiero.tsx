'use client'

import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { NOTIFICACION_META, type NotificacionTipo } from '@/db/enums'
import { TIPOS_CONFIGURABLES, type NotificacionesConfig } from '@/lib/notificaciones-config'
import { cn } from '@/lib/utils'
import { guardarAvisosQueQuiero } from '@/server/actions/equipo'

/**
 * Qué avisos quiero recibir.
 *
 * Sin esto, la campana se llena de cosas que no me importan y dejo de mirarla,
 * que es la peor forma de perder el aviso que sí importaba.
 */
export function AvisosQueQuiero({
  inicial,
  pushDisponible,
}: {
  inicial: NotificacionesConfig
  pushDisponible: boolean
}) {
  const router = useRouter()
  const [config, setConfig] = React.useState(inicial)
  const [pendiente, iniciar] = React.useTransition()
  const [abierto, setAbierto] = React.useState(false)

  const cambiado = React.useMemo(
    () => JSON.stringify(config) !== JSON.stringify(inicial),
    [config, inicial],
  )

  function alternar(tipo: NotificacionTipo, canal: 'campana' | 'push'): void {
    setConfig((c) => ({ ...c, [tipo]: { ...c[tipo], [canal]: !c[tipo][canal] } }))
  }

  function guardar(): void {
    iniciar(async () => {
      const r = await guardarAvisosQueQuiero(config)
      if (r.ok) {
        toast.success('Guardado')
        router.refresh()
      } else {
        toast.error(r.error ?? 'No se pudo guardar.')
      }
    })
  }

  if (!abierto) {
    return (
      <Panel>
        <PanelHeader
          titulo="Avisos que quiero recibir"
          descripcion={`${TIPOS_CONFIGURABLES.filter((t) => config[t].campana).length} de ${TIPOS_CONFIGURABLES.length} tipos encendidos en la campana.`}
          acciones={
            <Button variant="secundaria" size="sm" onClick={() => setAbierto(true)}>
              Configurar
            </Button>
          }
        />
      </Panel>
    )
  }

  return (
    <Panel>
      <PanelHeader
        titulo="Avisos que quiero recibir"
        descripcion="La campana queda en el panel. El push suena en el celular."
      />

      <div className="divide-y divide-borde/60">
        {TIPOS_CONFIGURABLES.map((t) => (
          <div key={t} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <span className="min-w-[200px] flex-1 text-[12.5px] text-texto">
              {NOTIFICACION_META[t].label}
            </span>

            <Interruptor
              activo={config[t].campana}
              texto="Campana"
              onClick={() => alternar(t, 'campana')}
            />
            <Interruptor
              activo={config[t].push && pushDisponible}
              texto="Push"
              deshabilitado={!pushDisponible || !config[t].campana}
              titulo={
                !pushDisponible
                  ? 'El push está apagado: faltan las claves VAPID. Generalas con npm run push:claves.'
                  : !config[t].campana
                    ? 'Encendé la campana primero: el push lleva a la lista.'
                    : undefined
              }
              onClick={() => alternar(t, 'push')}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-borde px-3 py-2">
        <p className="max-w-[520px] text-[11px] leading-relaxed text-texto-2">
          Falta el aviso por correo: mandar mails necesita un proveedor de envío que todavía no
          está elegido. Cuando lo definas, se suma acá como un canal más.
        </p>
        <div className="flex gap-2">
          <Button
            variant="fantasma"
            onClick={() => {
              setConfig(inicial)
              setAbierto(false)
            }}
            disabled={pendiente}
          >
            Cancelar
          </Button>
          <Button variant="primaria" onClick={guardar} disabled={pendiente || !cambiado}>
            {pendiente ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </div>
    </Panel>
  )
}

function Interruptor({
  activo,
  texto,
  onClick,
  deshabilitado = false,
  titulo,
}: {
  activo: boolean
  texto: string
  onClick: () => void
  deshabilitado?: boolean
  titulo?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={deshabilitado}
      title={titulo}
      aria-pressed={activo}
      className={cn(
        'h-7 w-[74px] shrink-0 rounded-[4px] border text-[11.5px] font-medium',
        activo
          ? 'border-acento/40 bg-acento-tenue text-acento'
          : 'border-borde bg-elevada text-texto-2',
        deshabilitado && 'cursor-not-allowed opacity-40',
      )}
    >
      {texto}
    </button>
  )
}

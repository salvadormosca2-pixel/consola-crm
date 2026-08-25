'use client'

import { Eraser, FlaskConical, UserCog, Smartphone } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Panel } from '@/components/ui/panel'
import { ROL_META } from '@/db/enums'
import { cn } from '@/lib/utils'
import { entrarDePrueba, type CuentaDePrueba } from '@/server/actions/auth'

/**
 * Entrar de un toque, sin contraseña.
 *
 * Solo aparece con el modo prueba encendido, y solo lista cuentas de
 * demostración. Es para poder saltar de rol a rol mirando la app sin tipear
 * credenciales veinte veces.
 */
export function AccesoRapido({ cuentas }: { cuentas: CuentaDePrueba[] }) {
  const [pendiente, iniciar] = React.useTransition()
  const [entrando, setEntrando] = React.useState<string | null>(null)

  function entrar(email: string): void {
    setEntrando(email)
    iniciar(async () => {
      const r = await entrarDePrueba(email)
      if (r.error) {
        toast.error(r.error)
        setEntrando(null)
      }
    })
  }

  return (
    <Panel className="mb-3 border-ambar/35">
      <div className="flex items-center gap-1.5 border-b border-ambar/25 bg-ambar-tenue px-3 py-1.5">
        <FlaskConical className="h-3.5 w-3.5 shrink-0 text-ambar" aria-hidden />
        <span className="rotulo text-ambar">Modo prueba · sin contraseña</span>
      </div>

      <div className="divide-y divide-borde/60">
        {cuentas.map((c) => {
          const Icono = c.rol === 'setter' ? Smartphone : UserCog
          return (
            <button
              key={c.email}
              onClick={() => entrar(c.email)}
              disabled={pendiente}
              className={cn(
                'flex w-full items-center gap-2.5 px-3 py-2.5 text-left',
                'transition-colors duration-150 hover:bg-elevada disabled:opacity-50',
              )}
            >
              <Icono className="h-4 w-4 shrink-0 text-texto-2" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-texto">
                  {c.nombre}
                  <span className="ml-1.5 text-[11px] text-texto-2">{ROL_META[c.rol].label}</span>
                </span>
                <span className="block truncate text-[11.5px] text-texto-2">{c.detalle}</span>
              </span>
              <span className="shrink-0 text-[11.5px] text-ambar">
                {entrando === c.email ? 'Entrando…' : 'Entrar'}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-borde px-3 py-2">
        <p className="min-w-[180px] flex-1 text-[11px] leading-relaxed text-texto-2">
          Solo cuentas de demostración, y solo fuera de producción. Se apaga sacando{' '}
          <code className="dato text-texto">MODO_PRUEBA</code> de{' '}
          <code className="dato text-texto">.env.local</code>.
        </p>
        <LimpiarCache />
      </div>
    </Panel>
  )
}

/**
 * Salida de emergencia mientras se prueba.
 *
 * El service worker de la PWA queda instalado en el navegador y sobrevive a los
 * reinicios del servidor. Si algo quedó raro después de un cambio, esto lo saca
 * de en medio sin tener que abrir las herramientas de desarrollo.
 */
function LimpiarCache() {
  const [pendiente, setPendiente] = React.useState(false)

  async function limpiar(): Promise<void> {
    setPendiente(true)
    try {
      if ('serviceWorker' in navigator) {
        const registros = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registros.map((r) => r.unregister()))
      }
      if ('caches' in window) {
        const nombres = await caches.keys()
        await Promise.all(nombres.map((n) => caches.delete(n)))
      }
      window.location.reload()
    } catch {
      toast.error('No se pudo limpiar. Probá con Ctrl+Shift+R.')
      setPendiente(false)
    }
  }

  return (
    <button
      onClick={() => void limpiar()}
      disabled={pendiente}
      title="Desinstala el service worker y borra la caché del navegador."
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-[4px] border border-borde bg-elevada px-2 text-[11.5px] text-texto-2 hover:text-texto disabled:opacity-50"
    >
      <Eraser className="h-3.5 w-3.5" aria-hidden />
      {pendiente ? 'Limpiando…' : 'Limpiar caché'}
    </button>
  )
}

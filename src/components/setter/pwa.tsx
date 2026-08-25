'use client'

import { BellRing, Download, X } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { registrarPush } from '@/server/actions/setter'
import { cn } from '@/lib/utils'

/**
 * Lo que convierte la web en una app en el celular del setter.
 *
 * Tres piezas, todas silenciosas si no hacen falta:
 *   · registra el service worker,
 *   · ofrece instalar cuando el navegador dice que se puede,
 *   · ofrece activar las notificaciones si el push está configurado.
 *
 * Ninguna aparece si no puede funcionar. Un botón de "activar notificaciones"
 * sin claves VAPID del lado del servidor sería una pantalla de relleno.
 */

export function RegistrarServiceWorker(): null {
  React.useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
      console.error('No se pudo registrar el service worker:', err)
    })
  }, [])
  return null
}

interface EventoDeInstalacion extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const CLAVE_DESCARTE = 'consola.instalar.descartado'

/**
 * Cinta de instalación.
 *
 * En Android el navegador avisa cuándo se puede instalar y se muestra el
 * botón. En iPhone no existe ese aviso: hay que explicar el camino de
 * "Compartir → Agregar a inicio", porque nadie lo encuentra solo.
 */
export function CintaInstalar({ className }: { className?: string }) {
  const [evento, setEvento] = React.useState<EventoDeInstalacion | null>(null)
  const [enIphone, setEnIphone] = React.useState(false)
  const [oculto, setOculto] = React.useState(true)

  React.useEffect(() => {
    const yaInstalada =
      window.matchMedia('(display-mode: standalone)').matches ||
      // Safari en iOS no soporta display-mode: standalone en versiones viejas.
      (window.navigator as { standalone?: boolean }).standalone === true

    if (yaInstalada || localStorage.getItem(CLAVE_DESCARTE) === '1') return

    const esIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
    setEnIphone(esIos)
    setOculto(!esIos)

    function alPoderInstalar(e: Event) {
      e.preventDefault()
      setEvento(e as EventoDeInstalacion)
      setOculto(false)
    }

    window.addEventListener('beforeinstallprompt', alPoderInstalar)
    return () => window.removeEventListener('beforeinstallprompt', alPoderInstalar)
  }, [])

  if (oculto) return null

  function descartar(): void {
    localStorage.setItem(CLAVE_DESCARTE, '1')
    setOculto(true)
  }

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-[6px] border border-ambar/35 bg-ambar-tenue px-3 py-2.5',
        className,
      )}
    >
      <Download className="mt-0.5 h-4 w-4 shrink-0 text-ambar" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-texto">Instalá la app</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-texto-2">
          {enIphone
            ? 'Tocá Compartir abajo y elegí "Agregar a pantalla de inicio". Te queda el ícono como cualquier app.'
            : 'Te queda el ícono en el celular y abre sin el navegador.'}
        </p>
        {evento ? (
          <Button
            variant="primaria"
            className="mt-2 h-10 px-4"
            onClick={() => {
              void evento.prompt().then(() => {
                void evento.userChoice.then(({ outcome }) => {
                  if (outcome === 'accepted') setOculto(true)
                })
              })
            }}
          >
            Instalar ahora
          </Button>
        ) : null}
      </div>
      <button
        onClick={descartar}
        aria-label="No mostrar más"
        className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-texto-2 hover:text-texto"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

/**
 * La clave VAPID viaja en base64url y el navegador la quiere en bytes. Se
 * reserva el buffer a mano para que el tipo sea un `ArrayBuffer` común: un
 * `Uint8Array` genérico no es asignable a `BufferSource`.
 */
function base64ABytes(base64: string): Uint8Array<ArrayBuffer> {
  const relleno = '='.repeat((4 - (base64.length % 4)) % 4)
  const normal = (base64 + relleno).replace(/-/g, '+').replace(/_/g, '/')
  const crudo = atob(normal)
  const bytes = new Uint8Array(new ArrayBuffer(crudo.length))
  for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i)
  return bytes
}

/**
 * Botón de activar avisos. Solo aparece si el servidor tiene claves de push y
 * el permiso todavía no se decidió.
 */
export function ActivarAvisos({ clavePublica }: { clavePublica: string | null }) {
  const [estado, setEstado] = React.useState<'oculto' | 'ofrecer' | 'pidiendo'>('oculto')

  React.useEffect(() => {
    if (!clavePublica) return
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return
    }
    if (Notification.permission === 'default') setEstado('ofrecer')
  }, [clavePublica])

  if (estado === 'oculto' || !clavePublica) return null

  async function activar(): Promise<void> {
    setEstado('pidiendo')
    try {
      const permiso = await Notification.requestPermission()
      if (permiso !== 'granted') {
        toast.message('Sin avisos en el celular', {
          description: 'Igual vas a ver todo al abrir la app.',
        })
        setEstado('oculto')
        return
      }

      const registro = await navigator.serviceWorker.ready
      const suscripcion = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ABytes(clavePublica!),
      })

      const json = suscripcion.toJSON() as { keys?: { p256dh?: string; auth?: string } }
      const r = await registrarPush({
        endpoint: suscripcion.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
        userAgent: navigator.userAgent.slice(0, 300),
      })

      if (r.ok) {
        toast.success('Listo, te van a llegar los avisos')
        setEstado('oculto')
      } else {
        toast.error(r.error ?? 'No se pudieron activar.')
        setEstado('ofrecer')
      }
    } catch (err) {
      console.error('Error al activar los avisos:', err)
      toast.error('No se pudieron activar los avisos en este celular.')
      setEstado('ofrecer')
    }
  }

  return (
    <button
      onClick={() => void activar()}
      disabled={estado === 'pidiendo'}
      className="flex w-full items-center gap-2 rounded-[6px] border border-borde bg-elevada px-3 py-2.5 text-left disabled:opacity-50"
    >
      <BellRing className="h-4 w-4 shrink-0 text-ambar" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-texto">Activar avisos</span>
        <span className="block text-[12px] text-texto-2">
          Te avisamos cuando te tocan seguimientos.
        </span>
      </span>
    </button>
  )
}

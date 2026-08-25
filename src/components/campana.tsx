'use client'

import { Bell, Check } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { NOTIFICACION_META } from '@/db/enums'
import { haceCuanto } from '@/lib/tz'
import { cn } from '@/lib/utils'
import { marcarNotificacionesLeidas } from '@/server/actions/equipo'
import { leerNotificaciones } from '@/server/actions/notificaciones'
import type { FilaNotificacion } from '@/server/setters/notificaciones'

/**
 * La campana del encabezado.
 *
 * Cada aviso dice quién, qué y cuándo, y un click lleva a la ficha. Se refresca
 * sola cada 25 segundos: no es tiempo real de verdad, pero para "un setter
 * marcó que alguien contestó" media pantalla de diferencia no cambia nada, y
 * evita sostener una conexión abierta desde cada pestaña del panel.
 *
 * Cuando entra algo nuevo mientras la pestaña está abierta, además salta un
 * aviso emergente: es lo que hace que me entere sin estar mirando.
 */
const CADA = 25_000

export function Campana({
  inicial,
  sinLeerInicial,
}: {
  inicial: FilaNotificacion[]
  sinLeerInicial: number
}) {
  const router = useRouter()
  const [abierta, setAbierta] = React.useState(false)
  const [filas, setFilas] = React.useState(inicial)
  const [sinLeer, setSinLeer] = React.useState(sinLeerInicial)
  const vistas = React.useRef(new Set(inicial.map((n) => n.id)))

  React.useEffect(() => {
    let vivo = true

    async function traer(): Promise<void> {
      if (document.hidden) return
      try {
        const r = await leerNotificaciones()
        if (!vivo || !r.ok) return

        const nuevas = r.filas.filter((n) => !vistas.current.has(n.id) && !n.leida)
        for (const n of nuevas) {
          vistas.current.add(n.id)
          toast(n.texto, {
            duration: 8000,
            action: n.enlace
              ? { label: 'Ver', onClick: () => router.push(n.enlace as never) }
              : undefined,
          })
        }
        for (const n of r.filas) vistas.current.add(n.id)

        setFilas(r.filas)
        setSinLeer(r.sinLeer)
      } catch {
        /* Sin red: se reintenta en el próximo ciclo. */
      }
    }

    const alVolver = (): void => void traer()
    const id = setInterval(alVolver, CADA)
    document.addEventListener('visibilitychange', alVolver)

    return () => {
      vivo = false
      clearInterval(id)
      // Con una función anónima el listener quedaba puesto para siempre y se
      // sumaba otro en cada montaje: al rato eran veinte consultas por vuelta.
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [router])

  function marcarTodas(): void {
    void marcarNotificacionesLeidas().then(() => {
      setFilas((f) => f.map((n) => ({ ...n, leida: true })))
      setSinLeer(0)
    })
  }

  return (
    <div className="relative">
      <button
        onClick={() => setAbierta((v) => !v)}
        aria-label={sinLeer > 0 ? `${sinLeer} avisos sin leer` : 'Avisos'}
        aria-expanded={abierta}
        className="relative flex h-7 w-7 items-center justify-center rounded-[4px] text-texto-2 transition-colors duration-150 hover:bg-elevada hover:text-texto"
      >
        <Bell className="h-3.5 w-3.5" aria-hidden />
        {sinLeer > 0 ? (
          <span className="dato absolute -right-0.5 -top-0.5 min-w-[14px] rounded-[7px] bg-rojo px-[3px] text-center text-[9px] font-medium leading-[14px] text-white">
            {sinLeer > 99 ? '99+' : sinLeer}
          </span>
        ) : null}
      </button>

      {abierta ? (
        <>
          <button
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Cerrar"
            onClick={() => setAbierta(false)}
            tabIndex={-1}
          />
          <div className="absolute right-0 top-9 z-50 max-h-[70vh] w-[340px] overflow-y-auto rounded-[6px] border border-borde bg-superficie">
            <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-borde bg-superficie px-3 py-2">
              <span className="rotulo">Avisos</span>
              {sinLeer > 0 ? (
                <Button variant="fantasma" size="sm" onClick={marcarTodas}>
                  <Check aria-hidden />
                  Marcar leídas
                </Button>
              ) : null}
            </div>

            {filas.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12px] text-texto-2">
                Cuando un setter marque una respuesta o agende una reunión, aparece acá.
              </p>
            ) : (
              <ul className="divide-y divide-borde/60">
                {filas.map((n) => (
                  <li key={n.id}>
                    <Enlace enlace={n.enlace} onIr={() => setAbierta(false)}>
                      <span
                        className={cn(
                          'mt-1 block h-1.5 w-1.5 shrink-0 rounded-full',
                          n.leida ? 'bg-transparent' : 'bg-ambar',
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] leading-snug text-texto">
                          {n.texto}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-texto-2">
                          {NOTIFICACION_META[n.tipo].label} · {haceCuanto(n.createdAt)}
                        </span>
                      </span>
                    </Enlace>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}

function Enlace({
  enlace,
  onIr,
  children,
}: {
  enlace: string | null
  onIr: () => void
  children: React.ReactNode
}) {
  const clases = 'flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-elevada/50'
  if (!enlace) return <div className={clases}>{children}</div>
  return (
    <Link href={enlace as never} onClick={onIr} className={clases}>
      {children}
    </Link>
  )
}

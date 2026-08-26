import type { Metadata, Viewport } from 'next'
import { LogOut } from 'lucide-react'

import { NavInferior } from '@/components/setter/nav-inferior'
import { RegistrarServiceWorker } from '@/components/setter/pwa'
import { salir } from '@/server/actions/auth'
import { requerirSetter } from '@/server/session'
import { contarAvisosSinLeer } from '@/server/setters/avisos'

export const metadata: Metadata = {
  title: 'Setters',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Setters' },
}

export const viewport: Viewport = {
  themeColor: '#02100D',
  width: 'device-width',
  initialScale: 1,
  // La app se instala y ocupa toda la pantalla: hay que dibujar debajo de la
  // muesca y del indicador de inicio, y compensarlo con los safe-area.
  viewportFit: 'cover',
  // Sin zoom por pellizco: los botones ya son grandes y el pellizco accidental
  // con una mano deja la pantalla torcida a mitad de una tanda.
  maximumScale: 1,
  userScalable: false,
}

/**
 * La app del setter.
 *
 * Pantalla angosta primero: una columna, botones de 48 px, barra de pestañas
 * abajo. No hay tablas, ni filtros, ni menús. Lo único que se escribe en toda
 * la app es una nota opcional.
 */
export default async function LayoutSetter({ children }: { children: React.ReactNode }) {
  const sesion = await requerirSetter()
  const sinLeer = await contarAvisosSinLeer(sesion.setterId)

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-borde bg-superficie pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-12 max-w-[560px] items-center gap-2 px-3">
          <span className="font-[family-name:var(--font-titulo)] text-[15px] font-bold tracking-[-0.04em]">
            101leads<span className="text-acento">.</span>
          </span>
          <span className="ml-auto truncate text-[12.5px] text-texto-2">{sesion.nombre}</span>
          <form action={salir}>
            <button
              type="submit"
              aria-label="Salir"
              className="flex h-9 w-9 items-center justify-center rounded-[4px] text-texto-2"
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[560px] flex-1 px-3 py-3 pb-[calc(72px+env(safe-area-inset-bottom))]">
        {children}
      </main>

      <NavInferior sinLeer={sinLeer} />
      <RegistrarServiceWorker />
    </div>
  )
}

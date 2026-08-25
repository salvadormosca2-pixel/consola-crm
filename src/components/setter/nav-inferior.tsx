'use client'

import { Bell, BookOpen, ListChecks, Send } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

const PESTANAS = [
  { href: '/hoy', label: 'Hoy', icono: Send },
  { href: '/mis-leads', label: 'Mis leads', icono: ListChecks },
  { href: '/referencias', label: 'Referencias', icono: BookOpen },
  { href: '/avisos', label: 'Avisos', icono: Bell },
] as const

/**
 * Cuatro pestañas abajo, del alto del pulgar.
 *
 * Nada de menús ni de gavetas: el setter usa esto parado, con una mano,
 * cambiando de app cada quince segundos. Todo lo que necesita tiene que estar
 * a un toque desde donde el pulgar ya está.
 */
export function NavInferior({ sinLeer }: { sinLeer: number }) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-borde bg-superficie pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-[560px]">
        {PESTANAS.map(({ href, label, icono: Icono }) => {
          const activa = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              aria-current={activa ? 'page' : undefined}
              className={cn(
                'relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5',
                'transition-colors duration-150',
                activa ? 'text-acento' : 'text-texto-2',
              )}
            >
              <Icono className="h-5 w-5" aria-hidden />
              <span className="text-[11px] font-medium">{label}</span>
              {href === '/avisos' && sinLeer > 0 ? (
                <span
                  className="dato absolute right-[calc(50%-22px)] top-2 min-w-[16px] rounded-[8px] bg-rojo px-1 text-center text-[9.5px] font-medium leading-4 text-white"
                  aria-label={`${sinLeer} sin leer`}
                >
                  {sinLeer}
                </span>
              ) : null}
              {activa ? (
                <span className="absolute inset-x-4 top-0 h-[2px] bg-acento" aria-hidden />
              ) : null}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

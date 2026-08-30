'use client'

import {
  BookOpen,
  CalendarDays,
  History,
  Inbox,
  LogOut,
  MessageSquareText,
  Upload,
  UserCog,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Campana } from '@/components/campana'
import { salir } from '@/server/actions/auth'
import { cn } from '@/lib/utils'
import type { FilaNotificacion } from '@/server/setters/notificaciones'

/**
 * Ocho secciones y nada más.
 *
 * Cada una responde una pregunta concreta: quién trabajó, quién contestó, qué
 * reunión viene, quiénes son, de dónde salieron, cuándo les volvemos a escribir
 * y con qué, qué les contestamos cuando preguntan, y qué hizo cada uno. Todo lo
 * que no responde una pregunta que alguien se hace no está.
 */
const SECCIONES = [
  { href: '/equipo', label: 'Equipo', icono: UserCog },
  { href: '/respondieron', label: 'Respondieron', icono: Inbox },
  { href: '/reuniones', label: 'Reuniones', icono: CalendarDays },
  { href: '/contactos', label: 'Contactos', icono: Users },
  { href: '/importar', label: 'Importar', icono: Upload },
  { href: '/seguimientos', label: 'Seguimientos', icono: MessageSquareText },
  { href: '/configuracion/referencias', label: 'Referencias', icono: BookOpen },
  { href: '/actividad', label: 'Actividad', icono: History },
] as const

export function Nav({
  usuario,
  notificaciones,
  sinLeer,
}: {
  usuario: string
  notificaciones: FilaNotificacion[]
  sinLeer: number
}) {
  const pathname = usePathname()

  /*
   * Gana la sección más específica. Referencias cuelga de /configuracion, y el
   * control de seguimientos cuelga de /equipo: con un `startsWith` suelto se
   * marcarían dos y ninguna diría dónde estás parado.
   */
  const seccionActiva = SECCIONES.map((s) => s.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0]

  return (
    <header className="sticky top-0 z-30 border-b border-borde bg-superficie">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-1 px-3 sm:px-4">
        <Link
          href="/equipo"
          className="mr-3 shrink-0 select-none text-[15px] font-semibold tracking-[-0.02em] text-texto"
        >
          101leads
        </Link>

        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" aria-label="Secciones">
          {SECCIONES.map(({ href, label, icono: Icono }) => {
            const activo = href === seccionActiva
            return (
              <Link
                key={href}
                href={href}
                aria-current={activo ? 'page' : undefined}
                className={cn(
                  'flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium',
                  'transition-colors duration-150',
                  activo
                    ? 'bg-acento-tenue text-acento'
                    : 'text-texto-2 hover:bg-elevada hover:text-texto',
                )}
              >
                <Icono className="h-4 w-4" aria-hidden />
                <span>{label}</span>
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
          <Campana inicial={notificaciones} sinLeerInicial={sinLeer} />
          <span className="hidden text-[12.5px] text-texto-2 md:inline">{usuario}</span>
          <form action={salir}>
            <button
              type="submit"
              title="Salir"
              aria-label="Salir"
              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-texto-2 transition-colors duration-150 hover:bg-elevada hover:text-texto"
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}

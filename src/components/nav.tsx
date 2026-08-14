'use client'

import {
  CalendarDays,
  FileText,
  Inbox,
  LogOut,
  MessagesSquare,
  Mic,
  Radio,
  Repeat,
  SendHorizontal,
  Settings,
  Upload,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { salir } from '@/server/actions/auth'
import { cn } from '@/lib/utils'

const SECCIONES = [
  { href: '/despachador', label: 'Despachador', icono: SendHorizontal },
  { href: '/mensajes', label: 'Mensajes', icono: MessagesSquare },
  { href: '/respondieron', label: 'Respondieron', icono: Inbox },
  { href: '/seguimientos', label: 'Seguimientos', icono: Repeat },
  { href: '/contactos', label: 'Contactos', icono: Users },
  { href: '/importar', label: 'Importar', icono: Upload },
  { href: '/plantillas', label: 'Plantillas', icono: FileText },
  { href: '/mi-voz', label: 'Mi voz', icono: Mic },
  { href: '/cuentas', label: 'Cuentas', icono: Radio },
  { href: '/configuracion', label: 'Configuración', icono: Settings },
  { href: '/reuniones', label: 'Reuniones', icono: CalendarDays, parte2: true },
] as const

export function Nav({ usuario }: { usuario: string }) {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-30 border-b border-borde bg-superficie">
      <div className="flex h-11 items-center gap-1 px-2 sm:px-3">
        <Link
          href="/contactos"
          className="mr-2 shrink-0 select-none font-[family-name:var(--font-titulo)] text-[14px] font-bold tracking-[-0.04em] text-texto"
        >
          consola<span className="text-ambar">.</span>
        </Link>

        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" aria-label="Secciones">
          {SECCIONES.map(({ href, label, icono: Icono, ...rest }) => {
            const activo = pathname === href || pathname.startsWith(`${href}/`)
            const parte2 = 'parte2' in rest && rest.parte2
            return (
              <Link
                key={href}
                href={href as never}
                aria-current={activo ? 'page' : undefined}
                className={cn(
                  'flex h-7 shrink-0 items-center gap-1.5 rounded-[4px] px-2 text-[12.5px] font-medium',
                  'transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
                  activo
                    ? 'bg-elevada text-texto'
                    : 'text-texto-2 hover:bg-elevada/60 hover:text-texto',
                )}
              >
                <Icono className="h-3.5 w-3.5" aria-hidden />
                <span>{label}</span>
                {parte2 ? (
                  <span
                    className="dato ml-0.5 hidden rounded-[3px] border border-borde px-1 text-[9px] text-texto-2/70 sm:inline"
                    title="Llega con el motor de envío"
                  >
                    2
                  </span>
                ) : null}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
          <span className="hidden text-[11.5px] text-texto-2 sm:inline">{usuario}</span>
          <form action={salir}>
            <button
              type="submit"
              title="Salir"
              aria-label="Salir"
              className="flex h-7 w-7 items-center justify-center rounded-[4px] text-texto-2 transition-colors duration-150 hover:bg-elevada hover:text-texto"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}

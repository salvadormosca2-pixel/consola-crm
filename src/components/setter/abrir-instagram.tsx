'use client'

import type { VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { buttonVariants } from '@/components/ui/button'
import { hrefDeInstagram, plataformaActual, type Plataforma } from '@/lib/abrir-instagram'
import { cn } from '@/lib/utils'

/**
 * "Abrir Instagram", como enlace y no como botón.
 *
 * La diferencia no es de estilo. Ni Android ni iOS le entregan un link a la
 * app cuando la navegación la arrancó un script: `window.open` y
 * `location.href` terminan en el navegador. Lo único que el sistema reconoce
 * como "esto lo pidió una persona" es el toque sobre un `<a href>` de verdad,
 * y por eso acá hay un `<a>` disfrazado de botón.
 *
 * El `href` se calcula recién montado y no al dibujar: `navigator` no existe
 * en el servidor, y si el `href` cambiara entre lo que renderiza el servidor y
 * lo que renderiza el celular, React tiraría todo abajo al hidratar.
 *
 * Lo que hay que copiar se copia en `onAbrir`, dentro del toque y antes de que
 * la pantalla se vaya: es la única ventana en que el navegador deja escribir
 * el portapapeles. No se cancela la navegación, así que el enlace sigue su
 * camino igual aunque el copiado falle.
 */
export function AbrirInstagram({
  link,
  onAbrir,
  variant,
  className,
  bloqueado = false,
  children,
  ...props
}: {
  /** El link que arma el servidor: `https://ig.me/m/usuario`. */
  link: string
  /** Lo que hay que hacer dentro del toque: copiar el mensaje, avisar al servidor. */
  onAbrir?: () => void
  variant?: VariantProps<typeof buttonVariants>['variant']
  className?: string
  /** No abrir todavía. Se usa contra el toque fantasma al cambiar de tarjeta. */
  bloqueado?: boolean
  children: React.ReactNode
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick' | 'children'>) {
  const [plataforma, setPlataforma] = React.useState<Plataforma | null>(null)

  React.useEffect(() => {
    setPlataforma(plataformaActual())
  }, [])

  // Antes de saber en qué está parado, el link común: es lo que renderiza el
  // servidor y lo que anda en cualquier lado.
  const href = plataforma === null ? link : hrefDeInstagram(link, plataforma)

  /*
   * En el celular el enlace va **sin** `target`. Una pestaña nueva rompe las
   * dos cosas: iOS no entrega Universal Links a la vista de navegador que abre
   * una PWA, y en Android queda una pestaña de `ig.me` que al volver se
   * recarga y dispara Instagram de nuevo sola. Sin `target`, o el sistema se
   * lleva el link a la app —y la pantalla ni se entera— o navega y se vuelve
   * con el botón de atrás.
   */
  const enEscritorio = plataforma === 'escritorio'

  return (
    <a
      href={href}
      {...(enEscritorio ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      aria-disabled={bloqueado || undefined}
      onClick={(e) => {
        if (bloqueado) {
          e.preventDefault()
          return
        }
        onAbrir?.()
      }}
      className={cn(variant ? buttonVariants({ variant }) : undefined, className)}
      {...props}
    >
      {children}
    </a>
  )
}

'use client'

import { Eye, EyeOff } from 'lucide-react'
import * as React from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Un campo de contraseña con el ojito para verla.
 *
 * Existe porque esto se tipea en un celular, parado, con el pulgar, mirando la
 * clave en un WhatsApp. Sin poder ver lo que se escribe, un error de una letra
 * se descubre recién al mandar, y el segundo intento se hace a ciegas otra vez.
 *
 * Arranca oculta: alguien puede estar mirando la pantalla por encima del
 * hombro. Mostrarla es una decisión de quien escribe, no el estado por defecto.
 */
export function CampoClave({
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'>) {
  const [visible, setVisible] = React.useState(false)

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? 'text' : 'password'}
        className={cn('pr-10', className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
        aria-pressed={visible}
        // `tabIndex={-1}` a propósito: al tabular desde el campo se pasa al
        // botón de enviar, que es lo que se quiere hacer. El ojito se toca.
        tabIndex={-1}
        className="absolute right-0 top-0 flex h-full w-10 items-center justify-center text-texto-2 hover:text-texto"
      >
        {visible ? (
          <EyeOff className="h-4 w-4" aria-hidden />
        ) : (
          <Eye className="h-4 w-4" aria-hidden />
        )}
      </button>
    </div>
  )
}

import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Un botón por intención, y nada más.
 *
 * `primaria` es la acción de la pantalla y va en azul; hay una sola por
 * pantalla. El resto es gris. Los colores de estado (verde, rojo) se reservan
 * para acciones que confirman o destruyen algo, no para decorar.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] text-[13px] font-medium ' +
    'transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] ' +
    'disabled:pointer-events-none disabled:opacity-45 ' +
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // El azul eléctrico aclara al pasar por encima y se hunde al apretar:
        // es la única superficie de la interfaz que lleva ese color lleno.
        primaria: 'bg-acento text-white hover:bg-acento-hover active:bg-acento-activo',
        secundaria: 'border border-borde bg-elevada text-texto hover:bg-elevada-2',
        contorno: 'border border-borde bg-transparent text-texto hover:bg-elevada',
        fantasma: 'text-texto-2 hover:bg-elevada hover:text-texto',
        destructiva: 'border border-rojo/30 bg-rojo-tenue text-rojo hover:bg-rojo/20',
        positiva: 'border border-verde/30 bg-verde-tenue text-verde hover:bg-verde/20',
      },
      size: {
        sm: 'h-7 px-2.5 text-[12px]',
        md: 'h-8.5 px-3',
        lg: 'h-10 px-4',
        icono: 'h-8 w-8 p-0',
        iconoSm: 'h-7 w-7 p-0',
      },
    },
    defaultVariants: { variant: 'secundaria', size: 'md' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
})

export { buttonVariants }

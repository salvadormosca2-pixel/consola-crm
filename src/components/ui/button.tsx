import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] text-[12.5px] font-medium ' +
    'transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] ' +
    'disabled:pointer-events-none disabled:opacity-40 ' +
    '[&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Acción principal: ámbar señal.
        primaria: 'bg-ambar text-fondo font-semibold hover:bg-[#f0b155] active:bg-[#d99530]',
        // Acción secundaria sobre superficie.
        secundaria: 'bg-elevada text-texto border border-borde hover:bg-[#2e3a48] hover:border-[#42525f]',
        contorno: 'border border-borde bg-transparent text-texto hover:bg-elevada',
        fantasma: 'text-texto-2 hover:bg-elevada hover:text-texto',
        destructiva: 'bg-rojo/15 text-rojo border border-rojo/35 hover:bg-rojo/25',
        positiva: 'bg-verde/15 text-verde border border-verde/35 hover:bg-verde/25',
      },
      size: {
        sm: 'h-6 px-2 text-[11.5px]',
        md: 'h-7.5 px-3',
        lg: 'h-9 px-4 text-[13px]',
        icono: 'h-7 w-7 p-0',
        iconoSm: 'h-6 w-6 p-0',
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

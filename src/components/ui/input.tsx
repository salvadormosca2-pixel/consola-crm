import * as React from 'react'

import { cn } from '@/lib/utils'

const BASE =
  'w-full rounded-[6px] border border-borde bg-fondo text-[13.5px] text-texto ' +
  'placeholder:text-texto-2/60 ' +
  'transition-colors duration-150 hover:border-borde-fuerte ' +
  'focus:border-acento focus:outline-none focus:ring-2 focus:ring-acento/15 ' +
  'disabled:cursor-not-allowed disabled:bg-elevada disabled:opacity-60 ' +
  'aria-[invalid=true]:border-rojo aria-[invalid=true]:ring-rojo/15'

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  function Input({ className, type, ...props }, ref) {
    return <input type={type} ref={ref} className={cn(BASE, 'h-8.5 px-2.5', className)} {...props} />
  },
)

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(BASE, 'resize-y px-2.5 py-2 leading-relaxed', className)}
        {...props}
      />
    )
  },
)

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      className={cn('mb-1 block text-[12px] font-medium text-texto', className)}
      {...props}
    />
  )
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <Label>{label}</Label>
      {children}
      {error ? (
        <p className="mt-1 text-[12px] text-rojo">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[12px] leading-relaxed text-texto-2">{hint}</p>
      ) : null}
    </div>
  )
}

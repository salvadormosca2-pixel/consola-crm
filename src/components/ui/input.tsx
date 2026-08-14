import * as React from 'react'

import { cn } from '@/lib/utils'

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  function Input({ className, type, ...props }, ref) {
    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          'h-7.5 w-full rounded-[4px] border border-borde bg-fondo px-2 text-[12.5px] text-texto',
          'placeholder:text-texto-2/70',
          'transition-colors duration-150 hover:border-[#42525f]',
          'focus:border-ambar focus:outline-none focus:ring-1 focus:ring-ambar/40',
          'disabled:cursor-not-allowed disabled:opacity-40',
          'aria-[invalid=true]:border-rojo aria-[invalid=true]:ring-rojo/30',
          className,
        )}
        {...props}
      />
    )
  },
)

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'w-full rounded-[4px] border border-borde bg-fondo px-2 py-1.5 text-[12.5px] text-texto',
          'placeholder:text-texto-2/70 resize-y',
          'transition-colors duration-150 hover:border-[#42525f]',
          'focus:border-ambar focus:outline-none focus:ring-1 focus:ring-ambar/40',
          'disabled:cursor-not-allowed disabled:opacity-40',
          className,
        )}
        {...props}
      />
    )
  },
)

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      className={cn('mb-1 block text-[11px] font-medium text-texto-2', className)}
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
        <p className="mt-1 text-[11px] text-rojo">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[11px] text-texto-2/80">{hint}</p>
      ) : null}
    </div>
  )
}

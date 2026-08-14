import * as React from 'react'

import { cn } from '@/lib/utils'

/** Superficie base de la consola. Sin sombras difusas, borde de 1 px, radio 6. */
export function Panel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-[6px] border border-borde bg-superficie', className)}
      {...props}
    />
  )
}

export function PanelHeader({
  titulo,
  descripcion,
  acciones,
  className,
}: {
  titulo: React.ReactNode
  descripcion?: React.ReactNode
  acciones?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border-b border-borde px-3 py-2',
        className,
      )}
    >
      <div className="min-w-0">
        <div className="rotulo">{titulo}</div>
        {descripcion ? <p className="mt-0.5 text-[11.5px] text-texto-2">{descripcion}</p> : null}
      </div>
      {acciones ? <div className="flex shrink-0 items-center gap-1.5">{acciones}</div> : null}
    </div>
  )
}

const TONOS = {
  neutral: 'border-borde bg-elevada text-texto-2',
  activo: 'border-ambar/35 bg-ambar/12 text-ambar',
  positivo: 'border-verde/35 bg-verde/12 text-verde',
  negativo: 'border-rojo/35 bg-rojo/12 text-rojo',
} as const

export type Tono = keyof typeof TONOS

/** Etiqueta de estado. Radio 4, nunca cápsula. */
export function Chip({
  tono = 'neutral',
  className,
  ...props
}: React.ComponentProps<'span'> & { tono?: Tono }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-px text-[10.5px] font-medium leading-4',
        TONOS[tono],
        className,
      )}
      {...props}
    />
  )
}

/** Un número con su rótulo. La unidad de lectura del panel de instrumentos. */
export function Metrica({
  rotulo,
  valor,
  sufijo,
  tono,
  className,
}: {
  rotulo: string
  valor: React.ReactNode
  sufijo?: string
  tono?: 'ambar' | 'verde' | 'rojo'
  className?: string
}) {
  const color =
    tono === 'ambar' ? 'text-ambar' : tono === 'verde' ? 'text-verde' : tono === 'rojo' ? 'text-rojo' : 'text-texto'
  return (
    <div className={cn('min-w-0', className)}>
      <div className="rotulo truncate">{rotulo}</div>
      <div className={cn('dato mt-0.5 text-[19px] font-medium leading-none', color)}>
        {valor}
        {sufijo ? <span className="ml-0.5 text-[11px] text-texto-2">{sufijo}</span> : null}
      </div>
    </div>
  )
}

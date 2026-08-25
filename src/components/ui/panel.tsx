import * as React from 'react'

import { cn } from '@/lib/utils'

/** Tarjeta blanca sobre el gris del fondo. Es lo único que agrupa contenido. */
export function Panel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-[10px] border border-borde bg-superficie', className)}
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
        'flex flex-wrap items-center justify-between gap-3 border-b border-borde px-4 py-3',
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-[14px] font-semibold text-texto">{titulo}</div>
        {descripcion ? (
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-texto-2">{descripcion}</p>
        ) : null}
      </div>
      {acciones ? <div className="flex shrink-0 items-center gap-1.5">{acciones}</div> : null}
    </div>
  )
}

const TONOS = {
  neutral: 'border-borde bg-elevada text-texto-2',
  activo: 'border-ambar/25 bg-ambar-tenue text-ambar',
  positivo: 'border-verde/25 bg-verde-tenue text-verde',
  negativo: 'border-rojo/25 bg-rojo-tenue text-rojo',
} as const

export type Tono = keyof typeof TONOS

/** Etiqueta de estado. Es lo único que lleva color además de los botones. */
export function Chip({
  tono = 'neutral',
  className,
  ...props
}: React.ComponentProps<'span'> & { tono?: Tono }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[11.5px] font-medium leading-4',
        TONOS[tono],
        className,
      )}
      {...props}
    />
  )
}

/** Un número grande con su rótulo abajo. */
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
    tono === 'ambar'
      ? 'text-ambar'
      : tono === 'verde'
        ? 'text-verde'
        : tono === 'rojo'
          ? 'text-rojo'
          : 'text-texto'
  return (
    <div className={cn('min-w-0', className)}>
      <div className={cn('dato text-[24px] font-semibold leading-none', color)}>
        {valor}
        {sufijo ? <span className="ml-0.5 text-[13px] text-texto-2">{sufijo}</span> : null}
      </div>
      <div className="mt-1 truncate text-[12px] text-texto-2">{rotulo}</div>
    </div>
  )
}

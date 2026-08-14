import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import type * as React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Estado vacío. Nunca dice "no hay datos": dice qué hacer para que los haya.
 */
export function EmptyState({
  icono: Icono,
  titulo,
  detalle,
  accion,
  className,
}: {
  icono: LucideIcon
  titulo: string
  detalle: React.ReactNode
  accion?: { texto: string; href: string }
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-14 text-center',
        className,
      )}
    >
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-[5px] border border-borde bg-elevada">
        <Icono className="h-4 w-4 text-texto-2" aria-hidden />
      </div>
      <h2 className="text-[15px]">{titulo}</h2>
      <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-texto-2">{detalle}</p>
      {accion ? (
        <Button asChild variant="primaria" size="md" className="mt-4">
          <Link href={accion.href as never}>{accion.texto}</Link>
        </Button>
      ) : null}
    </div>
  )
}

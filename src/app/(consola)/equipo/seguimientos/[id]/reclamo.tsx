'use client'

import { BellRing } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { recordar } from '@/server/actions/avisos'

/** El aviso que le llega al celular. Queda registrado con sus números. */
export function Reclamo({
  setterId,
  nombre,
  alerta,
}: {
  setterId: string
  nombre: string
  alerta: boolean
}) {
  const router = useRouter()
  const [pendiente, iniciar] = React.useTransition()

  return (
    <Button
      variant={alerta ? 'destructiva' : 'secundaria'}
      size="lg"
      disabled={pendiente}
      onClick={() =>
        iniciar(async () => {
          const r = await recordar(setterId, 'seguimientos')
          if (r.ok) {
            toast.success(`Le llegó el aviso a ${nombre}`)
            router.refresh()
          } else {
            toast.error(r.error ?? 'No se pudo avisar.')
          }
        })
      }
    >
      <BellRing aria-hidden />
      Reclamarle los seguimientos
    </Button>
  )
}

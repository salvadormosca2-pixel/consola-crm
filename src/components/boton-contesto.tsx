'use client'

import { MessageSquare } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Marcar a mano que alguien contestó, desde cualquier lista.
 *
 * Vive suelto y no dentro de la bandeja porque lo usan las dos: la lista de
 * contactos y cualquier pantalla que necesite registrar una respuesta que no
 * entró por el celular de un setter.
 */
export function BotonContesto({
  contactId,
  nombre,
  onHecho,
}: {
  contactId: string
  nombre: string
  onHecho?: () => void
}) {
  const [pendiente, iniciar] = React.useTransition()
  const [abierto, setAbierto] = React.useState(false)
  const [texto, setTexto] = React.useState('')

  if (!abierto) {
    return (
      <Button variant="positiva" size="sm" onClick={() => setAbierto(true)}>
        <MessageSquare aria-hidden />
        Contestó
      </Button>
    )
  }

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault()
        iniciar(async () => {
          const { marcarQueContesto } = await import('@/server/actions/contacts')
          const r = await marcarQueContesto(contactId, texto)
          if (r.ok) {
            toast.success(`${nombre} pasó a Respondió — se cortó la secuencia`)
            setAbierto(false)
            setTexto('')
            onHecho?.()
          } else toast.error(r.error ?? 'No se pudo registrar.')
        })
      }}
    >
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Qué dijo (opcional)"
        autoFocus
        className={cn(
          'h-6 w-48 rounded-[4px] border border-borde bg-fondo px-1.5 text-[11.5px]',
          'focus:border-ambar focus:outline-none',
        )}
      />
      <Button type="submit" variant="positiva" size="sm" disabled={pendiente}>
        Guardar
      </Button>
      <Button type="button" variant="fantasma" size="sm" onClick={() => setAbierto(false)}>
        Cancelar
      </Button>
    </form>
  )
}

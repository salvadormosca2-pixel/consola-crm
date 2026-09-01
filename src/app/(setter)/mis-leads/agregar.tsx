'use client'

import { Plus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Panel } from '@/components/ui/panel'
import { agregarMiLead } from '@/server/actions/setter'

/**
 * Agregar a alguien que conocés.
 *
 * El pozo son negocios que no conoce nadie. Pero el setter también conoce
 * gente —el local de la esquina, el negocio de un amigo, alguien que le
 * preguntó por Instagram— y esos son los mejores leads que hay, porque hay
 * confianza antes del primer mensaje. Sin esta pantalla terminaban en una nota
 * del celular: sin guion, sin seguimiento y sin quedar registrados como suyos
 * el día que cierran.
 *
 * Dos campos y listo. Cerrado es un botón de una línea, porque esta pantalla se
 * usa para mirar la lista, no para cargar: el que carga sabe que viene a
 * cargar.
 */
export function Agregar() {
  const router = useRouter()
  const [abierto, setAbierto] = React.useState(false)
  const [instagram, setInstagram] = React.useState('')
  const [negocio, setNegocio] = React.useState('')
  const [ciudad, setCiudad] = React.useState('')
  const [pendiente, iniciar] = React.useTransition()

  function guardar(): void {
    iniciar(async () => {
      const r = await agregarMiLead({ instagram, negocio, ciudad })
      if (r.ok) {
        toast.success(`Listo: ${negocio} está en tu cola de hoy`)
        setInstagram('')
        setNegocio('')
        setCiudad('')
        setAbierto(false)
        router.refresh()
      } else {
        toast.error(r.error ?? 'No se pudo agregar.')
      }
    })
  }

  if (!abierto) {
    return (
      <Button
        variant="contorno"
        className="h-11 w-full"
        onClick={() => setAbierto(true)}
      >
        <Plus aria-hidden />
        Agregar un lead que conozco
      </Button>
    )
  }

  return (
    <Panel>
      <div className="flex items-center justify-between border-b border-borde px-3 py-2">
        <span className="text-[13px] font-semibold text-texto">Agregar un lead</span>
        <button
          type="button"
          aria-label="Cerrar"
          onClick={() => setAbierto(false)}
          className="flex h-8 w-8 items-center justify-center rounded-[5px] text-texto-2"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="space-y-2.5 px-3 py-3">
        <Input
          value={instagram}
          onChange={(e) => setInstagram(e.target.value)}
          placeholder="cuenta de Instagram"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="h-11"
          aria-label="Cuenta de Instagram"
        />
        <Input
          value={negocio}
          onChange={(e) => setNegocio(e.target.value)}
          placeholder="nombre del negocio"
          className="h-11"
          aria-label="Nombre del negocio"
        />
        <Input
          value={ciudad}
          onChange={(e) => setCiudad(e.target.value)}
          placeholder="ciudad (opcional)"
          className="h-11"
          aria-label="Ciudad"
        />

        <p className="text-[12px] leading-relaxed text-texto-2">
          Entra a tu cola de hoy con el mismo mensaje de entrada que el resto, y queda como tuyo.
          Si ese negocio ya lo está trabajando alguien del equipo, te avisa y no lo agrega.
        </p>

        <Button
          variant="primaria"
          className="h-12 w-full text-[14px]"
          disabled={pendiente || instagram.trim().length === 0 || negocio.trim().length < 2}
          onClick={guardar}
        >
          {pendiente ? 'Agregando…' : 'Agregar a mi cola'}
        </Button>
      </div>
    </Panel>
  )
}

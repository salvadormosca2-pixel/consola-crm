'use client'

import { TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { PALABRA_PARA_VACIAR } from '@/lib/equipo'
import { vaciarEquipo } from '@/server/actions/equipo'
import type { ResumenDelVaciado } from '@/server/setters/borrar'

/**
 * Arrancar de cero con el equipo.
 *
 * Es la acción más destructiva de la consola, así que hace dos cosas antes de
 * estar disponible: se abre a propósito —cerrada no es más que una línea de
 * texto— y pide escribir una palabra. Un "¿estás seguro?" con un botón al lado
 * se contesta que sí sin leer; escribir VACIAR no.
 *
 * Y sobre todo dice los números **antes**: cuántas cuentas se borran, cuántos
 * leads vuelven al pozo y cuántos no vuelven porque ya contestaron. Nadie puede
 * decidir esto sin verlos.
 */
export function Vaciar({ resumen }: { resumen: ResumenDelVaciado }) {
  const router = useRouter()
  const [abierto, setAbierto] = React.useState(false)
  const [palabra, setPalabra] = React.useState('')
  const [pendiente, iniciar] = React.useTransition()

  if (resumen.setters === 0) return null

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="text-[12px] text-texto-2 underline decoration-dotted underline-offset-2 hover:text-rojo"
      >
        Vaciar el equipo y empezar de cero
      </button>
    )
  }

  function vaciar(): void {
    iniciar(async () => {
      const r = await vaciarEquipo(palabra)
      if (r.ok) {
        toast.success(
          `Se borraron ${r.setters} cuentas. ${r.alPozo} leads volvieron al pozo.`,
        )
        setAbierto(false)
        setPalabra('')
        router.refresh()
      } else {
        toast.error(r.error)
      }
    })
  }

  return (
    <Panel className="border-rojo/40">
      <PanelHeader
        titulo="Vaciar el equipo"
        descripcion="Para arrancar de cero: se borran todas las cuentas de setter y los leads que nadie contestó vuelven al pozo. No se puede deshacer."
      />

      <div className="space-y-3 px-4 py-3">
        <ul className="space-y-1 text-[12.5px] leading-relaxed text-texto-2">
          <li>
            <span className="dato text-texto">{resumen.setters}</span> cuentas de setter se borran,
            con sus cuentas de Instagram, sus asignaciones y{' '}
            <span className="dato text-texto">{resumen.envios}</span> envíos registrados. Las
            cuentas de admin no se tocan.
          </li>
          <li>
            <span className="dato text-texto">{resumen.alPozo}</span> leads vuelven al pozo como
            recién importados: sin dueño y sin contador de mensajes.
          </li>
          {resumen.conRespuesta > 0 ? (
            <li className="text-ambar">
              <span className="dato">{resumen.conRespuesta}</span> leads no vuelven al pozo:
              contestaron, tienen una reunión o están descartados, así que no son leads fríos y
              volver a mandarles un primer mensaje sería empezar de nuevo una conversación que ya
              existe. Conservan su ficha, sus mensajes y sus reuniones; lo único que pierden es la
              asignación, que se va con el setter.
            </li>
          ) : null}
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={palabra}
            onChange={(e) => setPalabra(e.target.value)}
            placeholder={PALABRA_PARA_VACIAR}
            className="w-40"
            aria-label={`Escribí ${PALABRA_PARA_VACIAR} para confirmar`}
          />
          <Button
            variant="destructiva"
            disabled={pendiente || palabra.trim().toUpperCase() !== PALABRA_PARA_VACIAR}
            onClick={vaciar}
          >
            <TriangleAlert aria-hidden />
            Borrar las {resumen.setters} cuentas
          </Button>
          <Button
            variant="fantasma"
            disabled={pendiente}
            onClick={() => {
              setAbierto(false)
              setPalabra('')
            }}
          >
            Cancelar
          </Button>
        </div>
      </div>
    </Panel>
  )
}

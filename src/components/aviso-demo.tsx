import { FlaskConical } from 'lucide-react'

import { hayDatosDemo } from '@/server/contacts'

/**
 * Aviso de datos de demostración.
 *
 * Va en todas las pantallas que muestran datos. Que sea imposible confundir una
 * demo con la base real es más importante que el aire que ocupa: el día que
 * entren los clientes de verdad, este cartel tiene que haber desaparecido.
 */
export async function AvisoDemo() {
  if (!(await hayDatosDemo())) return null

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[5px] border border-ambar/35 bg-ambar/8 px-2.5 py-1.5">
      <FlaskConical className="h-3.5 w-3.5 shrink-0 text-ambar" aria-hidden />
      <span className="text-[12px] text-texto">
        Estos son datos de demostración, no tus clientes.
      </span>
      <span className="text-[11.5px] text-texto-2">
        Para borrarlos y empezar con tu base real, corré{' '}
        <code className="dato rounded-[3px] border border-borde bg-fondo px-1 text-texto">
          npm run demo:limpiar
        </code>
      </span>
    </div>
  )
}

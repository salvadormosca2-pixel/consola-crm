'use client'

import { Check, ClipboardCopy, KeyRound } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { copiarAlPortapapeles } from '@/lib/copiar'

/**
 * La tarjeta de acceso.
 *
 * Es lo único que necesito para dar de alta a alguien: un botón que copia todo
 * y lo pego por donde ya hablo con él. No se manda ningún mail desde el
 * sistema; un mail más es un mail que no lee.
 *
 * La contraseña se muestra **una sola vez**. Está guardada con hash y no se
 * puede recuperar: si se pierde, se genera otra. Es la única forma de que
 * "guardada con hash" signifique algo de verdad.
 */
export function TarjetaDeAcceso({
  nombre,
  email,
  password,
  url,
  tarjeta,
  titulo = 'Acceso creado',
}: {
  nombre: string
  email: string
  password: string
  url: string
  tarjeta: string
  titulo?: string
}) {
  const [copiado, setCopiado] = React.useState(false)

  async function copiar(): Promise<void> {
    try {
      if (await copiarAlPortapapeles(tarjeta)) {
        setCopiado(true)
        setTimeout(() => setCopiado(false), 2500)
      } else {
        toast.error('No se pudo copiar. Seleccioná el texto de abajo y copialo a mano.')
      }
    } catch {
      toast.error('No se pudo copiar. Seleccioná el texto de abajo y copialo a mano.')
    }
  }

  return (
    <Panel className="border-verde/40">
      <div className="flex items-center gap-2 border-b border-verde/30 bg-verde-tenue px-3 py-2">
        <KeyRound className="h-4 w-4 shrink-0 text-verde" aria-hidden />
        <span className="rotulo text-verde">{titulo}</span>
      </div>

      <div className="space-y-3 px-3 py-3">
        <p className="text-[12.5px] leading-relaxed text-texto-2">
          Mandale esto a {nombre}. La contraseña no se puede volver a ver: si se pierde, generás
          otra desde Equipo, en la sección Accesos.
        </p>

        <dl className="space-y-1.5 rounded-[5px] border border-borde bg-fondo px-3 py-2.5">
          <Dato rotulo="Link" valor={url} />
          <Dato rotulo="Usuario" valor={email} />
          <Dato rotulo="Contraseña" valor={password} destacado />
        </dl>

        <Button
          variant={copiado ? 'positiva' : 'primaria'}
          size="lg"
          className="w-full"
          onClick={() => void copiar()}
        >
          {copiado ? <Check aria-hidden /> : <ClipboardCopy aria-hidden />}
          {copiado ? 'Copiado — pegalo por WhatsApp' : 'Copiar todo'}
        </Button>

        <details className="rounded-[5px] border border-borde bg-fondo">
          <summary className="cursor-pointer px-2.5 py-2 text-[12px] text-texto-2">
            Ver el texto completo que se copia
          </summary>
          <pre className="overflow-x-auto whitespace-pre-wrap border-t border-borde px-2.5 py-2 text-[12px] leading-relaxed text-texto">
            {tarjeta}
          </pre>
        </details>
      </div>
    </Panel>
  )
}

function Dato({
  rotulo,
  valor,
  destacado = false,
}: {
  rotulo: string
  valor: string
  destacado?: boolean
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="rotulo w-[72px] shrink-0">{rotulo}</dt>
      <dd
        className={
          'dato min-w-0 flex-1 break-all ' +
          (destacado ? 'text-[15px] text-ambar' : 'text-[12.5px] text-texto')
        }
      >
        {valor}
      </dd>
    </div>
  )
}

import { Instagram, MessageCircle } from 'lucide-react'
import Link from 'next/link'
import type { Metadata } from 'next'

import { AvisoDemo } from '@/components/aviso-demo'
import { CapMeter } from '@/components/cap-meter'
import { Panel } from '@/components/ui/panel'
import { leerCupos } from '@/server/accounts'
import { armarCola } from '@/server/dispatch'

import { Cola } from './cola'

export const metadata: Metadata = { title: 'Despachador · Consola' }
export const dynamic = 'force-dynamic'

export default async function PaginaDespachador({
  searchParams,
}: {
  searchParams: Promise<{ canal?: string }>
}) {
  const { canal: crudo } = await searchParams
  const canal = crudo === 'instagram' ? 'instagram' : 'whatsapp'

  const [cuentas, cola] = await Promise.all([leerCupos(), armarCola(canal)])
  const delCanal = cuentas.filter((c) => c.channel === canal)

  return (
    <div className="space-y-3">
      <AvisoDemo />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[20px]">Despachador</h1>
          <p className="mt-0.5 text-[12.5px] text-texto-2">
            La cola del día: abrir el chat, confirmar que salió, seguir con el próximo.
          </p>
        </div>
        <CapMeter cuentas={delCanal} />
      </div>

      {/* Los dos canales van separados a propósito: mezclarlos genera errores
          de envío, porque la mecánica de cada uno es distinta. */}
      <nav className="flex gap-0.5 border-b border-borde" aria-label="Canal">
        <Solapa
          href="/despachador"
          activa={canal === 'whatsapp'}
          icono={<MessageCircle className="h-3.5 w-3.5" aria-hidden />}
          texto="WhatsApp"
        />
        <Solapa
          href="/despachador?canal=instagram"
          activa={canal === 'instagram'}
          icono={<Instagram className="h-3.5 w-3.5" aria-hidden />}
          texto="Instagram"
        />
      </nav>

      {delCanal.length === 0 ? (
        <Panel className="px-6 py-12 text-center">
          <h2 className="text-[15px]">
            No hay cuentas de {canal === 'whatsapp' ? 'WhatsApp' : 'Instagram'} en condiciones de
            enviar
          </h2>
          <p className="mt-1.5 text-[12.5px] text-texto-2">
            Cargá al menos una cuenta activa, con su checklist de preparación completo.
          </p>
        </Panel>
      ) : (
        <>
          {/* Si nada puede mandar solo, decir por qué y adónde ir. Un botón que
              dice "Abrir WhatsApp" sin explicación deja pensando que está roto. */}
          {cola.items.length > 0 && !cola.items.some((i) => i.envioAutomatico) ? (
            <div className="rounded-[5px] border border-ambar/35 bg-ambar/8 px-2.5 py-1.5 text-[12px]">
              <span className="text-texto">
                Los mensajes salen abriendo WhatsApp porque todavía no hay servidor conectado.
              </span>{' '}
              <Link href="/configuracion" className="text-ambar underline underline-offset-2">
                Conectar Evolution o Chatwoot
              </Link>{' '}
              <span className="text-texto-2">
                y el botón pasa a mandar de una, sin abrir nada.
              </span>
            </div>
          ) : null}

          {cola.totales.sinPlantilla > 0 ? (
            <div className="rounded-[5px] border border-ambar/35 bg-ambar/8 px-2.5 py-1.5 text-[12px]">
              <span className="text-texto">
                {cola.totales.sinPlantilla} contactos no tienen plantilla para su paso.
              </span>{' '}
              <Link href="/plantillas" className="text-ambar underline underline-offset-2">
                Crear una plantilla
              </Link>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-texto-2">
            <span>
              Cupo disponible hoy en este canal:{' '}
              <span className="dato text-texto">{cola.cupoDisponible}</span> mensajes
            </span>
            {cola.totales.saltados > 0 ? (
              <span className="text-ambar">
                {cola.totales.saltados} quedaron fuera porque les falta un dato de la plantilla
              </span>
            ) : null}
          </div>

          <Cola cola={cola} />
        </>
      )}
    </div>
  )
}

function Solapa({
  href,
  activa,
  icono,
  texto,
}: {
  href: string
  activa: boolean
  icono: React.ReactNode
  texto: string
}) {
  return (
    <Link
      href={href as never}
      aria-current={activa ? 'page' : undefined}
      className={
        'flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-150 ' +
        (activa ? 'border-ambar text-texto' : 'border-transparent text-texto-2 hover:text-texto')
      }
    >
      {icono}
      {texto}
    </Link>
  )
}

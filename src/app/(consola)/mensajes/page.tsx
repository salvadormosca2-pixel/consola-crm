import type { Metadata } from 'next'

import { esPaso, type Paso } from '@/lib/mensajes-config'
import { requerirAdmin } from '@/server/session'
import { leerConfigDeMensajes, listarMensajes, rubrosConLeads } from '@/server/setters/mensajes'

import { Editor } from './editor'

export const metadata: Metadata = { title: 'Mensajes · 101leads' }
export const dynamic = 'force-dynamic'

/**
 * Los textos que mandan los setters, uno por situación.
 *
 * Es la pantalla que más mueve el resultado: el mensaje de entrada decide si
 * contestan y el de la oferta decide si compran. Cuándo sale cada uno se
 * define en Seguimientos — acá solo se escribe qué dicen.
 */
export default async function PaginaMensajes({
  searchParams,
}: {
  searchParams: Promise<{ situacion?: string }>
}) {
  await requerirAdmin()

  const { situacion } = await searchParams
  // Se entra desde Seguimientos apuntando a una situación puntual, casi siempre
  // a una que le falta el texto. Abrir siempre en la primera obligaría a
  // buscarla de nuevo entre nueve pestañas.
  const pedido = Number(situacion)
  const pasoInicial: Paso = esPaso(pedido) ? pedido : 1

  const [config, mensajes, rubros] = await Promise.all([
    leerConfigDeMensajes(),
    listarMensajes(),
    rubrosConLeads(),
  ])

  return <Editor config={config} mensajes={mensajes} rubros={rubros} pasoInicial={pasoInicial} />
}

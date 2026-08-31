import type { Metadata } from 'next'

import { esPaso, type Paso } from '@/lib/mensajes-config'
import { PASOS_DE_MENSAJES } from '@/lib/pistas'
import { requerirAdmin } from '@/server/session'
import { leerConfigDeMensajes, listarMensajes, rubrosConLeads } from '@/server/setters/mensajes'

import { Editor } from './editor'

export const metadata: Metadata = { title: 'Mensajes · 101leads' }
export const dynamic = 'force-dynamic'

/**
 * Los mensajes que no dependen de ningún día.
 *
 * Son la apertura —entrada y oferta, que es la pantalla que más mueve el
 * resultado: la entrada decide si contestan y la oferta decide si compran— y
 * los tres que salen en el acto cuando el setter marca qué contestó el lead.
 *
 * Los escalones de las pistas no están acá. Se escriben en Seguimientos,
 * pegados a su día, porque a los dos días y a los once no se escribe igual.
 */
export default async function PaginaMensajes({
  searchParams,
}: {
  searchParams: Promise<{ situacion?: string }>
}) {
  await requerirAdmin()

  const { situacion } = await searchParams
  /*
   * Se entra desde Seguimientos apuntando a un paso puntual, casi siempre a uno
   * al que le falta el texto. Abrir siempre en el primero obligaría a buscarlo
   * de nuevo entre las pestañas.
   *
   * Si apunta a un escalón de una pista se ignora: ese texto se escribe en
   * Seguimientos, y abrir una pestaña que no existe dejaría la pantalla vacía.
   */
  const pedido = Number(situacion)
  const pasoInicial: Paso =
    esPaso(pedido) && (PASOS_DE_MENSAJES as readonly number[]).includes(pedido)
      ? pedido
      : PASOS_DE_MENSAJES[0]!

  const [config, mensajes, rubros] = await Promise.all([
    leerConfigDeMensajes(),
    listarMensajes(),
    rubrosConLeads(),
  ])

  return <Editor config={config} mensajes={mensajes} rubros={rubros} pasoInicial={pasoInicial} />
}

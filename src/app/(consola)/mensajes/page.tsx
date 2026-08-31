import type { Metadata } from 'next'

import { esPrincipal, PASOS_PRINCIPALES, type Paso } from '@/lib/mensajes-config'
import { requerirAdmin } from '@/server/session'
import { leerConfigDeMensajes, listarMensajes, rubrosConLeads } from '@/server/setters/mensajes'

import { Editor } from './editor'

export const metadata: Metadata = { title: 'Mensajes · 101leads' }
export const dynamic = 'force-dynamic'

/**
 * Los mensajes principales: los que salen sin esperar ningún día.
 *
 * Es la pantalla que más mueve el resultado: el mensaje de entrada decide si
 * contestan y el de la oferta decide si compran.
 *
 * Los de seguimiento no están acá. Se escriben en Seguimientos, pegados al día
 * que los dispara, porque a los tres días y a los quince no se escribe igual.
 */
export default async function PaginaMensajes({
  searchParams,
}: {
  searchParams: Promise<{ situacion?: string }>
}) {
  await requerirAdmin()

  const { situacion } = await searchParams
  /*
   * Se entra desde Seguimientos apuntando a una situación puntual, casi siempre
   * a una que le falta el texto. Abrir siempre en la primera obligaría a
   * buscarla de nuevo entre las pestañas.
   *
   * Si apunta a una de seguimiento se ignora: ese texto ya no se escribe acá, y
   * abrir una pestaña que no existe dejaría la pantalla en blanco.
   */
  const pedido = Number(situacion)
  const pasoInicial: Paso = esPrincipal(pedido) ? pedido : PASOS_PRINCIPALES[0]!

  const [config, mensajes, rubros] = await Promise.all([
    leerConfigDeMensajes(),
    listarMensajes(),
    rubrosConLeads(),
  ])

  return <Editor config={config} mensajes={mensajes} rubros={rubros} pasoInicial={pasoInicial} />
}

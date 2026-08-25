import type { Metadata } from 'next'

import { requerirSetter } from '@/server/session'
import { referenciasPorCategoria } from '@/server/setters/referencias'

import { Consulta } from './consulta'

export const metadata: Metadata = { title: 'Referencias · Setters' }
export const dynamic = 'force-dynamic'

/**
 * Qué contestar cuando preguntan.
 *
 * Se abre en medio de una conversación, con el chat de Instagram esperando del
 * otro lado. Por eso todo pasa en el celular sin volver al servidor: se traen
 * todas y se filtran acá. Buscar tiene que ser instantáneo o no se usa.
 */
export default async function PaginaReferencias() {
  await requerirSetter()
  const grupos = await referenciasPorCategoria(true)

  return <Consulta grupos={grupos} />
}

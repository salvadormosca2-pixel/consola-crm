import type { Metadata } from 'next'

import { requerirAdmin } from '@/server/session'
import { listarReferencias } from '@/server/setters/referencias'

import { Editor } from './editor'

export const metadata: Metadata = { title: 'Referencias · 101leads' }
export const dynamic = 'force-dynamic'

/**
 * Qué contestar cuando el cliente pregunta.
 *
 * El setter tiene el texto que le escribí para cada lead, pero la conversación
 * se va a donde quiera el cliente: cuánto sale, quiénes son, con quién
 * trabajaron. Esto es lo que lee cuando eso pasa, y lo escribo yo entero para
 * que el equipo conteste como contestaría yo.
 */
export default async function PaginaReferencias() {
  await requerirAdmin()
  const referencias = await listarReferencias()

  return <Editor referencias={referencias} />
}

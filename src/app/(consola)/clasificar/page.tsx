import type { Metadata } from 'next'

import { requerirAdmin } from '@/server/session'
import { colaDeClasificacion } from '@/server/setters/clasificacion'

import { Cola } from './cola'

export const metadata: Metadata = { title: 'Clasificar · 101leads' }
export const dynamic = 'force-dynamic'

/**
 * La cola de clasificación.
 *
 * Contestar la oferta no dice por dónde sigue el lead: entre "cuánto sale" y
 * "no me interesa" hay un lead ganado y uno perdido, y de un texto libre no se
 * deduce cuál es. Lo decide una persona mirando el hilo.
 *
 * Tiene pantalla propia y no una pestaña en la bandeja porque es el cuello de
 * botella más caro de la operación: mientras nadie decide, el lead está parado,
 * y no es un desconocido — ya habló y está esperando.
 */
export default async function PaginaClasificar() {
  await requerirAdmin()
  const cola = await colaDeClasificacion()
  return <Cola cola={cola} />
}

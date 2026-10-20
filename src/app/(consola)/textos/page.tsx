import type { Metadata } from 'next'

import { requerirAdmin } from '@/server/session'
import { colaDeTextos } from '@/server/setters/textos'

import { Cola } from './cola'

export const metadata: Metadata = { title: 'Textos · 101leads' }
export const dynamic = 'force-dynamic'

/**
 * Los mensajes que hay que escribir.
 *
 * Reemplaza a la pantalla de plantillas, y no es el mismo tipo de pantalla:
 * antes se escribían seis textos con `{{negocio}}` adentro y servían para la
 * lista entera; ahora se escribe uno por lead, así que esto no es un
 * formulario de configuración sino una cola de trabajo que se vacía todos los
 * días.
 *
 * Arriba están los mensajes **generales**, uno por paso: son los que salen
 * cuando el lead no tiene uno propio, y son los que hacen que el equipo pueda
 * trabajar desde el minuto cero. Abajo, la cola de los leads, ordenada por
 * urgencia: el que está más cerca de vencer y el que tiene el seguimiento más
 * atrasado van primero.
 *
 * Un lead sin texto propio **y** sin general es el único que está parado: el
 * setter lo ve bloqueado en el celular y no puede hacer nada.
 */
export default async function PaginaTextos() {
  await requerirAdmin()
  const cola = await colaDeTextos()
  return <Cola cola={cola} />
}

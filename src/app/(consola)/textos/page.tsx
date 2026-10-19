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
 * Lo que la ordena es la urgencia: arriba los que no tienen nada escrito, y
 * entre esos, el que está más cerca de vencer o el que tiene el seguimiento
 * más atrasado. Un lead sin texto es un lead parado: el setter lo ve en el
 * celular bloqueado y no puede hacer nada hasta que alguien lo escriba.
 */
export default async function PaginaTextos() {
  await requerirAdmin()
  const cola = await colaDeTextos()
  return <Cola cola={cola} />
}

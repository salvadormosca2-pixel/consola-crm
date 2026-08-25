'use server'

import { exigirAdmin } from '@/server/session'
import { listarNotificaciones, type FilaNotificacion } from '@/server/setters/notificaciones'

/**
 * Lectura de la campana desde el navegador.
 *
 * Es una acción y no una ruta de API porque así hereda la sesión y el control
 * de rol sin duplicar nada: un setter que la llame recibe una lista vacía, no
 * los avisos del panel.
 */
export type ResultadoNotificaciones =
  | { ok: true; filas: FilaNotificacion[]; sinLeer: number }
  | { ok: false; filas: []; sinLeer: 0 }

export async function leerNotificaciones(): Promise<ResultadoNotificaciones> {
  try {
    const sesion = await exigirAdmin()
    const { filas, sinLeer } = await listarNotificaciones(sesion.userId)
    return { ok: true, filas, sinLeer }
  } catch {
    return { ok: false, filas: [], sinLeer: 0 }
  }
}

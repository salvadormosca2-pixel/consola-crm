/**
 * Marcas guardadas en el celular cuando no hay señal.
 *
 * El setter trabaja parado, cambiando de app, muchas veces con una barra de
 * señal. Si marca "Enviado" y el pedido no sale, la marca **no se pierde**: se
 * guarda acá y se manda sola cuando vuelve la conexión.
 *
 * Reintentar es gratis del lado del servidor: el índice único
 * `(assignment_id, tipo)` hace que la misma marca entre una sola vez, aunque
 * llegue tres veces. Por eso acá no hace falta ninguna lógica de deduplicación:
 * alcanza con no borrarla hasta que el servidor la acepte.
 */

const CLAVE = 'consola.marcas-pendientes'

export interface MarcaPendiente {
  assignmentId: string
  /** Cuándo la hizo, para poder mostrar "guardada hace 10 min". */
  cuando: number
}

function leerCrudo(): MarcaPendiente[] {
  if (typeof window === 'undefined') return []
  try {
    const crudo = window.localStorage.getItem(CLAVE)
    if (!crudo) return []
    const datos: unknown = JSON.parse(crudo)
    if (!Array.isArray(datos)) return []
    return datos.filter(
      (m): m is MarcaPendiente =>
        typeof m === 'object' && m !== null && typeof (m as MarcaPendiente).assignmentId === 'string',
    )
  } catch {
    // Almacenamiento lleno, modo privado o datos corruptos: se sigue sin cola.
    return []
  }
}

function escribir(marcas: MarcaPendiente[]): void {
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(marcas))
  } catch {
    /* Si el navegador no deja guardar, la marca se pierde igual que antes de
       existir esta cola. No hay nada mejor que hacer y no vale trabar la app. */
  }
}

export function pendientes(): MarcaPendiente[] {
  return leerCrudo()
}

export function encolar(assignmentId: string): void {
  const actuales = leerCrudo()
  if (actuales.some((m) => m.assignmentId === assignmentId)) return
  escribir([...actuales, { assignmentId, cuando: Date.now() }])
}

export function quitar(assignmentId: string): void {
  escribir(leerCrudo().filter((m) => m.assignmentId !== assignmentId))
}

export function vaciar(): void {
  escribir([])
}

/**
 * Manda las marcas guardadas, de a una y en orden.
 *
 * Se corta al primer fallo de red: si no hay señal para la primera, tampoco la
 * hay para la quinta, y seguir intentando solo gasta batería. Un rechazo del
 * servidor (el lead ya no es suyo, por ejemplo) sí saca la marca de la cola:
 * reintentarla para siempre la dejaría trabada.
 */
export async function sincronizar(
  enviar: (assignmentId: string) => Promise<{ ok: boolean }>,
): Promise<{ enviadas: number; quedan: number }> {
  let enviadas = 0

  for (const marca of leerCrudo()) {
    try {
      const r = await enviar(marca.assignmentId)
      quitar(marca.assignmentId)
      if (r.ok) enviadas++
    } catch {
      break
    }
  }

  return { enviadas, quedan: leerCrudo().length }
}

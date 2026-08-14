/**
 * Estado compartido entre los formularios y sus server actions.
 *
 * Vive fuera de los archivos `'use server'` a propósito: en un módulo de server
 * actions solo se pueden exportar funciones async, y exportar una constante
 * desde ahí la deja en `undefined` del lado del cliente.
 */
export type EstadoFormulario = {
  ok: boolean
  /** Mensaje general, cuando el error no corresponde a un campo puntual. */
  error: string | null
  /** Errores por campo, para pintarlos al lado de cada input. */
  campos: Record<string, string>
}

export const ESTADO_INICIAL: EstadoFormulario = { ok: false, error: null, campos: {} }

export type EstadoAccion = { ok: boolean; error: string | null }

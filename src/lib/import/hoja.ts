import * as XLSX from 'xlsx'

import { adivinarMapeo, type Mapeo } from './columns'
import { deduplicarArchivo, prepararFila, type FilaPreparada } from './rows'

/**
 * El archivo, convertido en filas.
 *
 * Vive acá y no dentro del Web Worker por un motivo concreto: el worker no se
 * puede importar desde un test —usa `self` y la librería del navegador—, así
 * que todo lo que estuviera adentro era código que nadie podía probar. Y era
 * justamente el código que decidía si se importaba algo o no se importaba nada.
 *
 * Es lógica pura: entra un buffer, salen filas. Sin red, sin base, sin estado.
 */

export interface HojaLeida {
  encabezados: string[]
  /** Solo las filas con algún dato. Excel agrega vacías al final él solo. */
  filas: string[][]
}

export function leerLaHoja(buffer: ArrayBuffer | Uint8Array): HojaLeida {
  const libro = XLSX.read(buffer, { type: 'array', cellDates: false, raw: false })

  const primeraHoja = libro.SheetNames[0]
  if (!primeraHoja) throw new Error('El archivo no tiene ninguna hoja.')

  const hoja = libro.Sheets[primeraHoja]
  if (!hoja) throw new Error('No se pudo leer la primera hoja.')

  // header:1 devuelve un array de arrays, sin inventar nombres de columna.
  // defval:'' evita que las celdas vacías corran las columnas de lugar.
  const matriz = XLSX.utils.sheet_to_json<string[]>(hoja, {
    header: 1,
    defval: '',
    blankrows: false,
    raw: false,
  })

  if (matriz.length === 0) throw new Error('El archivo está vacío.')

  const encabezados = (matriz[0] ?? []).map((h) => String(h ?? '').trim())
  if (encabezados.length === 0) throw new Error('No se encontró la fila de encabezados.')

  const filas = matriz
    .slice(1)
    .map((f) => (f ?? []).map((c) => String(c ?? '')))
    .filter((f) => f.some((c) => c.trim().length > 0))

  return { encabezados, filas }
}

/** Lo que la pantalla necesita para dejar elegir el mapeo. */
export interface Vistazo extends HojaLeida {
  vistaPrevia: string[][]
  totalFilas: number
  mapeoSugerido: Mapeo
}

export function vistazo(buffer: ArrayBuffer | Uint8Array): Vistazo {
  const hoja = leerLaHoja(buffer)
  return {
    ...hoja,
    vistaPrevia: hoja.filas.slice(0, 5),
    totalFilas: hoja.filas.length,
    mapeoSugerido: adivinarMapeo(hoja.encabezados, hoja.filas.slice(0, 40)),
  }
}

export interface Preparado {
  filas: FilaPreparada[]
  duplicadasEnArchivo: number
}

/**
 * El archivo entero, listo para escribir.
 *
 * `alAvanzar` existe solo para la barra de progreso del worker; en los tests se
 * omite. Devolver cero filas sobre un archivo que tenía filas es un fallo, y
 * quien llama tiene que tratarlo como tal — es exactamente lo que pasaba
 * inadvertido cuando esto vivía adentro del worker.
 */
export function prepararTodo(
  buffer: ArrayBuffer | Uint8Array,
  mapeo: Mapeo,
  alAvanzar?: (hechas: number, total: number) => void,
): Preparado {
  const { encabezados, filas } = leerLaHoja(buffer)

  const preparadas: FilaPreparada[] = []
  for (let i = 0; i < filas.length; i++) {
    // rowNumber empieza en 2 porque la 1 es el encabezado, igual que en Excel.
    preparadas.push(prepararFila(filas[i]!, mapeo, encabezados, i + 2))
    if (alAvanzar && (i % 100 === 0 || i === filas.length - 1)) {
      alAvanzar(i + 1, filas.length)
    }
  }

  const { unicas, duplicadas } = deduplicarArchivo(preparadas)
  return { filas: unicas, duplicadasEnArchivo: duplicadas.length }
}

/// <reference lib="webworker" />

import * as XLSX from 'xlsx'

import { adivinarMapeo, type Mapeo } from '@/lib/import/columns'
import { deduplicarArchivo, prepararFila, type FilaPreparada } from '@/lib/import/rows'

/**
 * Parseo del Excel en un hilo aparte.
 *
 * 1.000 filas parseadas y normalizadas en el hilo principal congelan la
 * pantalla varios segundos. Acá el navegador sigue respondiendo y la barra de
 * progreso avanza de verdad.
 */

type Entrada =
  | { tipo: 'leer'; archivo: ArrayBuffer; nombre: string }
  | { tipo: 'preparar'; mapeo: Mapeo }

type Salida =
  | { tipo: 'progreso'; etapa: string; hechas: number; total: number }
  | {
      tipo: 'leido'
      encabezados: string[]
      vistaPrevia: string[][]
      totalFilas: number
      mapeoSugerido: Mapeo
    }
  | { tipo: 'preparado'; filas: FilaPreparada[]; duplicadasEnArchivo: number }
  | { tipo: 'error'; mensaje: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

/** Se guardan entre mensajes para no volver a parsear al cambiar el mapeo. */
let encabezados: string[] = []
let filas: string[][] = []

ctx.addEventListener('message', (e: MessageEvent<Entrada>) => {
  try {
    if (e.data.tipo === 'leer') leer(e.data.archivo)
    else preparar(e.data.mapeo)
  } catch (err) {
    responder({
      tipo: 'error',
      mensaje: err instanceof Error ? err.message : 'No se pudo leer el archivo.',
    })
  }
})

function responder(msg: Salida): void {
  ctx.postMessage(msg)
}

function leer(buffer: ArrayBuffer): void {
  responder({ tipo: 'progreso', etapa: 'Leyendo el archivo', hechas: 0, total: 1 })

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

  encabezados = (matriz[0] ?? []).map((h) => String(h ?? '').trim())
  filas = matriz.slice(1).map((f) => (f ?? []).map((c) => String(c ?? '')))

  // Filas totalmente vacías al final de la hoja: Excel las agrega solo.
  filas = filas.filter((f) => f.some((c) => c.trim().length > 0))

  if (encabezados.length === 0) throw new Error('No se encontró la fila de encabezados.')

  responder({
    tipo: 'leido',
    encabezados,
    vistaPrevia: filas.slice(0, 5),
    totalFilas: filas.length,
    mapeoSugerido: adivinarMapeo(encabezados, filas.slice(0, 40)),
  })
}

function preparar(mapeo: Mapeo): void {
  const preparadas: FilaPreparada[] = []
  const total = filas.length

  for (let i = 0; i < total; i++) {
    // rowNumber empieza en 2 porque la 1 es el encabezado, igual que en Excel.
    preparadas.push(prepararFila(filas[i]!, mapeo, encabezados, i + 2))

    if (i % 100 === 0 || i === total - 1) {
      responder({ tipo: 'progreso', etapa: 'Normalizando', hechas: i + 1, total })
    }
  }

  responder({ tipo: 'progreso', etapa: 'Buscando repetidos', hechas: total, total })
  const { unicas, duplicadas } = deduplicarArchivo(preparadas)

  responder({ tipo: 'preparado', filas: unicas, duplicadasEnArchivo: duplicadas.length })
}

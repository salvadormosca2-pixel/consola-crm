/// <reference lib="webworker" />

import type { Mapeo } from '@/lib/import/columns'
import { prepararTodo, vistazo } from '@/lib/import/hoja'
import type { FilaPreparada } from '@/lib/import/rows'

/**
 * Parseo del Excel en un hilo aparte.
 *
 * 1.000 filas parseadas y normalizadas en el hilo principal congelan la
 * pantalla varios segundos. Acá el navegador sigue respondiendo y la barra de
 * progreso avanza de verdad.
 *
 * Lo único que vive en este archivo es el ir y venir de mensajes. Todo lo que
 * decide qué se importa está en `lib/import/hoja`, que sí se puede probar: el
 * worker no se puede importar desde un test porque usa `self` y la librería del
 * navegador, y tener lógica adentro significaba tenerla sin cobertura.
 */

/**
 * Los dos pedidos llevan el archivo. **El worker no guarda nada entre
 * mensajes**, y eso es a propósito.
 *
 * Antes se quedaba con las filas parseadas para no releer el Excel al cambiar
 * el mapeo. Suena a optimización sensata y costó una importación entera: el
 * worker pasó a *ser* el archivo abierto, así que cualquier cosa que lo
 * reiniciara —y la pantalla lo reiniciaba justo al importar— dejaba un worker
 * vacío que preparaba cero filas sin quejarse de nada.
 *
 * Releer el archivo cuesta milisegundos y pasa una sola vez, al importar. Que
 * cada pedido se baste a sí mismo vale muchísimo más que ese ahorro.
 */
type Entrada =
  | { tipo: 'leer'; archivo: ArrayBuffer; nombre: string }
  | { tipo: 'preparar'; archivo: ArrayBuffer; mapeo: Mapeo }

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

ctx.addEventListener('message', (e: MessageEvent<Entrada>) => {
  try {
    if (e.data.tipo === 'leer') leer(e.data.archivo)
    else preparar(e.data.archivo, e.data.mapeo)
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

  const v = vistazo(buffer)
  responder({
    tipo: 'leido',
    encabezados: v.encabezados,
    vistaPrevia: v.vistaPrevia,
    totalFilas: v.totalFilas,
    mapeoSugerido: v.mapeoSugerido,
  })
}

function preparar(buffer: ArrayBuffer, mapeo: Mapeo): void {
  const { filas, duplicadasEnArchivo } = prepararTodo(buffer, mapeo, (hechas, total) => {
    responder({ tipo: 'progreso', etapa: 'Normalizando', hechas, total })
  })

  responder({ tipo: 'preparado', filas, duplicadasEnArchivo })
}

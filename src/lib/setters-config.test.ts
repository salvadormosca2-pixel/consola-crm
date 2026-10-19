import { describe, expect, it } from 'vitest'

import { PISTAS, PISTA_META, primerPasoDe, type Paso } from './pistas'
import {
  alCalificar,
  cuandoSale,
  diasDelPaso,
  entrarAPista,
  proximoSeguimiento,
  SETTERS_CONFIG_DEFAULT,
  settersConfigSchema,
} from './setters-config'

/**
 * Por dónde sigue un lead, sin base de datos.
 *
 * Adónde va cada uno es la decisión de negocio del sistema y no depende de nada
 * externo, así que se prueba acá. Lo que se cuida no es cada caso suelto sino
 * las dos propiedades que sostienen todo: **la escalera no se encadena para
 * siempre** —cada toque de más es cupo gastado y riesgo de cuenta— y **nadie
 * queda parado en un paso que no existe**.
 */

const cfg = SETTERS_CONFIG_DEFAULT
const DIA = 86_400_000
const T0 = new Date('2026-03-10T12:00:00Z')

describe('el primer mensaje no encadena nada', () => {
  it('mandado el primero, lo que sigue lo decide una persona', () => {
    /*
     * Es el cambio de fondo. Antes acá se programaba solo un reintento de
     * apertura: un segundo mensaje a alguien que jamás abrió el chat, gastando
     * cupo que le hacía falta a los leads nuevos. Ahora, si nadie lo califica,
     * el lead vence y vuelve al pozo.
     */
    expect(proximoSeguimiento(cfg, 1, T0)).toBeNull()
  })

  it('calificarlo lo mete en el primer escalón, a sus días', () => {
    const s = alCalificar(cfg, T0)
    expect(s.paso).toBe(primerPasoDe('seguimiento').paso)
    expect(s.cuando.getTime()).toBe(T0.getTime() + diasDelPaso(cfg, s.paso) * DIA)
  })
})

describe('la escalera baja un escalón por vez y termina', () => {
  it('recorre todos sus escalones, en orden, y corta al final', () => {
    const esperados = PISTA_META.seguimiento.pasos.map((p) => p.paso)

    const recorridos: Paso[] = [esperados[0]!]
    let actual: Paso | null = esperados[0]!
    while (actual !== null) {
      const s = proximoSeguimiento(cfg, actual, T0)
      actual = s?.paso ?? null
      if (actual !== null) recorridos.push(actual)
    }

    expect(recorridos).toEqual(esperados)
  })

  it('cada escalón espera los días que dice el modelo', () => {
    for (const pista of PISTAS) {
      for (const p of PISTA_META[pista].pasos) {
        expect(diasDelPaso(cfg, p.paso)).toBe(p.diasDefault)
      }
    }
  })

  it('lo guardado le gana al default, y lo que falta cae en el default', () => {
    const tocado = settersConfigSchema.parse({ diasPorPaso: { '10': 9 } })
    expect(diasDelPaso(tocado, 10)).toBe(9)
    expect(diasDelPaso(tocado, 11)).toBe(diasDelPaso(cfg, 11))
  })

  it('ninguna rama se encadena para siempre', () => {
    // Si alguien engancha un ciclo, esto falla acá en vez de mandarle mensajes
    // a un lead hasta que lo bloqueen.
    for (const arranque of [1, 3, 10, 11, 12] as const) {
      let paso: Paso | null = arranque
      let vistos = 0
      while (paso !== null) {
        const s = proximoSeguimiento(cfg, paso, T0)
        paso = s?.paso ?? null
        vistos += 1
        expect(vistos).toBeLessThanOrEqual(8)
      }
    }
  })

  it('un paso retirado no encadena nada', () => {
    // Hay leads viejos parados en pasos que ya no existen en el modelo. Lo que
    // no puede pasar es que les salga el escalón de otra escalera.
    for (const p of [2, 6, 7, 8, 13, 17] as const) {
      expect(proximoSeguimiento(cfg, p, T0)).toBeNull()
    }
  })
})

describe('los días se cuentan desde el último movimiento', () => {
  it('el escalón sale contando desde ahí, no desde que arrancó la secuencia', () => {
    // El primer mensaje salió el lunes y el lead contestó el viernes: el
    // seguimiento cuenta desde el viernes. Contarlo desde el lunes se lo
    // mandaría encima de su propia respuesta.
    const viernes = new Date(T0.getTime() + 4 * DIA)
    const s = entrarAPista(cfg, 'seguimiento', viernes)
    expect(s.cuando.getTime()).toBe(viernes.getTime() + diasDelPaso(cfg, s.paso) * DIA)
    expect(cuandoSale(cfg, s.paso, viernes).getTime()).toBe(s.cuando.getTime())
  })
})

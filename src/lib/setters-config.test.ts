import { describe, expect, it } from 'vitest'

import {
  PISTAS,
  PISTA_META,
  primerPasoDe,
  type Paso,
} from './pistas'
import {
  cuandoSale,
  diasDelPaso,
  entrarAPista,
  mensajeDeInteres,
  mensajeDeRechazo,
  mensajeDeReunion,
  ofertaTrasLaRespuesta,
  proximoSeguimiento,
  type RespondioA,
  SETTERS_CONFIG_DEFAULT,
  settersConfigSchema,
  trasClasificar,
} from './setters-config'

/**
 * Por dónde sigue un lead, sin base de datos.
 *
 * Adónde va cada uno es la decisión de negocio del sistema y no depende de nada
 * externo, así que se prueba acá. Lo que se cuida no es cada caso suelto sino
 * las dos propiedades que sostienen todo: **ninguna escalera se encadena para
 * siempre** —cada toque de más es cupo gastado y riesgo de cuenta— y **nadie
 * queda parado en un paso que no existe**.
 */

const cfg = SETTERS_CONFIG_DEFAULT
const DIA = 86_400_000
const T0 = new Date('2026-03-10T12:00:00Z')

function siguiente(paso: Paso, respondioA: RespondioA = null) {
  return proximoSeguimiento(cfg, paso, T0, respondioA)
}

describe('el primer contacto se bifurca según si habló', () => {
  it('mandada la entrada y sin respuesta, nunca ve la oferta: va al reintento', () => {
    // Es el cambio de fondo: antes la oferta salía igual a las 24 horas, a
    // alguien que jamás abrió el chat.
    const s = siguiente(1, null)
    expect(s?.paso).toBe(primerPasoDe('sin_abrir').paso)
    expect(s?.cuando.getTime()).toBe(T0.getTime() + diasDelPaso(cfg, s!.paso) * DIA)
  })

  it('si contestó la entrada, la cadena no programa nada: la oferta sale en el acto', () => {
    // La programa la acción que marca la respuesta, no el envío.
    expect(siguiente(1, 'primero')).toBeNull()
    expect(ofertaTrasLaRespuesta(T0)).toEqual({ paso: 2, cuando: T0 })
  })

  it('mandada la oferta y sin respuesta, entra a silencio', () => {
    const s = siguiente(2, null)
    expect(s?.paso).toBe(primerPasoDe('silencio').paso)
  })

  it('si contestó la oferta, no decide la cadena: decide una persona', () => {
    expect(siguiente(2, 'segundo')).toBeNull()
  })

  it('haber contestado la entrada no lo salva de silencio si se calla en la oferta', () => {
    // Ya habló una vez, pero ante la oferta se calló igual. Sin esto el lead se
    // caía del sistema: no entraba a ninguna pista y no le llegaba nada más.
    const s = siguiente(2, 'primero')
    expect(s?.paso).toBe(primerPasoDe('silencio').paso)
  })
})

describe('las escaleras bajan un escalón por vez y terminan', () => {
  it('cada pista recorre todos sus escalones, en orden, y corta al final', () => {
    for (const pista of PISTAS) {
      if (pista === 'primer_contacto') continue
      const esperados = PISTA_META[pista].pasos.map((p) => p.paso)

      const recorridos: Paso[] = [esperados[0]!]
      let actual: Paso | null = esperados[0]!
      while (actual !== null) {
        const s = proximoSeguimiento(cfg, actual, T0, false)
        actual = s?.paso ?? null
        if (actual !== null) recorridos.push(actual)
      }

      expect(recorridos, `la pista ${pista} no recorre sus escalones`).toEqual(esperados)
    }
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
    for (const arranque of [1, 2, 3, 6, 7, 8, 13, 17] as const) {
      for (const respondioA of [null, 'primero', 'segundo'] as const) {
        let paso: Paso | null = arranque
        let vistos = 0
        while (paso !== null) {
          const s: ReturnType<typeof siguiente> = proximoSeguimiento(cfg, paso, T0, respondioA)
          paso = s?.paso ?? null
          vistos += 1
          expect(vistos).toBeLessThanOrEqual(8)
        }
      }
    }
  })

  it('los que salen por marca no encadenan nada', () => {
    for (const p of [6, 7, 8] as const) expect(siguiente(p)).toBeNull()
  })
})

describe('los días se cuentan desde el último movimiento', () => {
  it('el escalón sale contando desde ahí, no desde que arrancó la secuencia', () => {
    // La oferta salió el lunes y el lead contestó el viernes: el seguimiento
    // cuenta desde el viernes. Contarlo desde el lunes se lo mandaría encima de
    // su propia respuesta.
    const viernes = new Date(T0.getTime() + 4 * DIA)
    const s = entrarAPista(cfg, 'tibio', viernes)
    expect(s.cuando.getTime()).toBe(viernes.getTime() + diasDelPaso(cfg, s.paso) * DIA)
    expect(cuandoSale(cfg, s.paso, viernes).getTime()).toBe(s.cuando.getTime())
  })
})

describe('clasificar manda a cada lado lo que corresponde', () => {
  it('tibio y silencio entran a su pista y esperan su día', () => {
    for (const [destino, pista] of [
      ['tibio', 'tibio'],
      ['silencio', 'silencio'],
    ] as const) {
      const s = trasClasificar(cfg, destino, T0)
      expect(s.paso).toBe(primerPasoDe(pista).paso)
      expect(s.cuando.getTime()).toBe(T0.getTime() + diasDelPaso(cfg, s.paso) * DIA)
    }
  })

  it('el sí y el no salen en el acto: la persona está del otro lado', () => {
    expect(trasClasificar(cfg, 'interesado', T0)).toEqual({ paso: 6, cuando: T0 })
    expect(trasClasificar(cfg, 'no_interesa', T0)).toEqual({ paso: 7, cuando: T0 })
  })
})

describe('los que salen apenas el setter marca', () => {
  it('ninguno espera', () => {
    expect(mensajeDeInteres(T0)).toEqual({ paso: 6, cuando: T0 })
    expect(mensajeDeRechazo(T0)).toEqual({ paso: 7, cuando: T0 })
    expect(mensajeDeReunion(T0)).toEqual({ paso: 8, cuando: T0 })
  })
})

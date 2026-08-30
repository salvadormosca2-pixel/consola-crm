import { describe, expect, it } from 'vitest'

import {
  SETTERS_CONFIG_DEFAULT,
  mensajeDeInteres,
  mensajeDeRechazo,
  mensajeDeReunion,
  ofertaTrasLaRespuesta,
  proximoSeguimiento,
  type PasoDeSeguimiento,
} from './setters-config'

/**
 * La cadena de situaciones, sin base de datos.
 *
 * Qué mensaje sigue a cuál es una decisión de negocio y no depende de nada
 * externo, así que se prueba acá: son las reglas que deciden si a alguien le
 * llega el texto que corresponde a cómo está clasificado, o le llega otro.
 */

const cfg = SETTERS_CONFIG_DEFAULT
const DIA = 86_400_000
const HORA = 3_600_000
const T0 = new Date('2026-03-10T12:00:00Z')

function siguiente(paso: PasoDeSeguimiento, yaContesto = false) {
  return proximoSeguimiento(cfg, paso, T0, yaContesto)
}

describe('qué mensaje le sigue a cuál', () => {
  it('la entrada engancha la oferta, a las horas configuradas', () => {
    const s = siguiente(1)
    expect(s?.paso).toBe(2)
    expect(s?.cuando.getTime()).toBe(T0.getTime() + cfg.horasSegundoMensaje * HORA)
  })

  it('después de la oferta, el silencio se lee según quién lo hace', () => {
    // Nunca dijo nada: le toca el último intento.
    const mudo = siguiente(2, false)
    expect(mudo?.paso).toBe(3)
    expect(mudo?.cuando.getTime()).toBe(T0.getTime() + cfg.diasParaUltimoIntento * DIA)

    // Había hablado: no se le escribe igual que a un desconocido.
    const hablo = siguiente(2, true)
    expect(hablo?.paso).toBe(4)
    expect(hablo?.cuando.getTime()).toBe(T0.getTime() + cfg.diasParaRetomarConversacion * DIA)
  })

  it('la rama del que nunca habló se corta en el último intento', () => {
    // Tres mensajes sin una sola respuesta: el cuarto no lo va a despertar.
    expect(siguiente(3)).toBeNull()
  })

  it('los dos reenganches terminan en el último de todos', () => {
    for (const paso of [4, 5] as const) {
      const s = siguiente(paso)
      expect(s?.paso).toBe(9)
      expect(s?.cuando.getTime()).toBe(T0.getTime() + cfg.diasParaUltimoReenganche * DIA)
    }
  })

  it('mandado el "le interesa", lo que queda es su reenganche por si se enfría', () => {
    const s = siguiente(6)
    expect(s?.paso).toBe(5)
    expect(s?.cuando.getTime()).toBe(T0.getTime() + cfg.diasParaRetomarInteresado * DIA)
  })

  it('un no es un no, una reunión ya está, y el último es el último', () => {
    expect(siguiente(7)).toBeNull()
    expect(siguiente(8)).toBeNull()
    expect(siguiente(9)).toBeNull()
  })

  it('ninguna rama se encadena para siempre', () => {
    // Se recorre cada arranque hasta que se corta. Si alguna vez alguien
    // engancha un ciclo, esto no termina en vez de fallar raro en producción.
    for (const arranque of [1, 2, 6] as const) {
      for (const yaContesto of [false, true]) {
        let paso: PasoDeSeguimiento | null = arranque
        let vistos = 0
        while (paso !== null) {
          const s: ReturnType<typeof siguiente> = siguiente(paso, yaContesto)
          paso = s?.paso ?? null
          vistos += 1
          expect(vistos).toBeLessThanOrEqual(9)
        }
      }
    }
  })
})

describe('los que salen apenas el setter marca', () => {
  it('ninguno espera: el lead está del otro lado, ahora', () => {
    expect(ofertaTrasLaRespuesta(T0)).toEqual({ paso: 2, cuando: T0 })
    expect(mensajeDeInteres(T0)).toEqual({ paso: 6, cuando: T0 })
    expect(mensajeDeRechazo(T0)).toEqual({ paso: 7, cuando: T0 })
    expect(mensajeDeReunion(T0)).toEqual({ paso: 8, cuando: T0 })
  })
})

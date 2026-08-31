import { describe, expect, it } from 'vitest'

import {
  esDeSeguimiento,
  esPaso,
  esPrincipal,
  GRUPOS_DE_PASOS,
  GRUPOS_PRINCIPALES,
  PASO_META,
  PASOS,
  PASOS_DE_SEGUIMIENTO,
  PASOS_PRINCIPALES,
} from './mensajes-config'

/**
 * El reparto de los textos entre las dos pantallas.
 *
 * Los mensajes de seguimiento se escriben en Seguimientos, pegados a su día, y
 * el resto en Mensajes. El reparto se calcula a partir de una sola lista, así
 * que lo que hay que probar no es cada caso sino la propiedad que sostiene
 * todo: **cada situación aparece en exactamente una de las dos pantallas**.
 *
 * Si mañana se agrega una situación al final y nadie la clasifica, el riesgo no
 * es que salga un error: es que su texto no se pueda escribir en ninguna parte
 * y los leads que caigan ahí queden bloqueados para siempre, sin que nada lo
 * avise. Eso es lo que cuida este archivo.
 */

describe('dónde se escribe cada texto', () => {
  it('cada situación cae en una pantalla, y en una sola', () => {
    for (const p of PASOS) {
      const enSeguimientos = PASOS_DE_SEGUIMIENTO.includes(p)
      const enMensajes = PASOS_PRINCIPALES.includes(p)
      expect(
        [enSeguimientos, enMensajes].filter(Boolean).length,
        `"${PASO_META[p].label}" (paso ${p}) tiene que estar en exactamente una pantalla`,
      ).toBe(1)
    }
  })

  it('las dos listas juntas son todas las situaciones', () => {
    const juntas = [...PASOS_DE_SEGUIMIENTO, ...PASOS_PRINCIPALES].sort((a, b) => a - b)
    expect(juntas).toEqual([...PASOS])
  })

  it('los que salen por silencio son los de seguimiento', () => {
    // Son justo los que el lead recibe sin haber hecho nada nuevo: se calló.
    expect([...PASOS_DE_SEGUIMIENTO]).toEqual([3, 4, 5, 9])
    for (const p of PASOS_DE_SEGUIMIENTO) expect(esDeSeguimiento(p)).toBe(true)
  })

  it('la entrada y la oferta se escriben en Mensajes, no en Seguimientos', () => {
    // Es la separación que pidió el usuario: los de inicio son otra cosa.
    expect(esPrincipal(1)).toBe(true)
    expect(esPrincipal(2)).toBe(true)
    expect(esDeSeguimiento(1)).toBe(false)
    expect(esDeSeguimiento(2)).toBe(false)
  })

  it('los que el setter marca salen en el acto, así que no son seguimientos', () => {
    for (const p of [6, 7, 8] as const) {
      expect(esDeSeguimiento(p)).toBe(false)
      expect(esPrincipal(p)).toBe(true)
    }
  })
})

describe('los grupos que ve cada pantalla', () => {
  it('Mensajes no muestra ninguna pestaña de seguimiento', () => {
    const pasos = GRUPOS_PRINCIPALES.flatMap((g) => [...g.pasos])
    expect(pasos.some(esDeSeguimiento)).toBe(false)
  })

  it('Mensajes no se queda con un grupo vacío', () => {
    // "Se calló" es entero de seguimiento: tiene que desaparecer, no quedar
    // como un título con nada abajo.
    for (const g of GRUPOS_PRINCIPALES) expect(g.pasos.length).toBeGreaterThan(0)
    expect(GRUPOS_PRINCIPALES.map((g) => g.titulo)).not.toContain('Se calló')
  })

  it('los grupos de Mensajes salen de la escalera completa, sin inventar nada', () => {
    const todos = GRUPOS_DE_PASOS.flatMap((g) => [...g.pasos])
    for (const p of PASOS_PRINCIPALES) expect(todos).toContain(p)
  })

  it('la escalera sigue teniendo las nueve, de seguimiento o no', () => {
    const todos = GRUPOS_DE_PASOS.flatMap((g) => [...g.pasos]).sort((a, b) => a - b)
    expect(todos).toEqual([...PASOS])
  })
})

describe('esPrincipal filtra lo que llega por la URL', () => {
  it('acepta solo situaciones que se escriben en Mensajes', () => {
    // Mensajes abre con ?situacion=N. Un número de seguimiento abriría una
    // pestaña que ya no existe y dejaría la pantalla vacía.
    expect(esPrincipal(1)).toBe(true)
    expect(esPrincipal(3)).toBe(false)
  })

  it('rechaza lo que no es una situación', () => {
    for (const basura of [0, 10, -1, 1.5, NaN, '2', null, undefined, {}]) {
      expect(esPrincipal(basura)).toBe(false)
    }
  })

  it('esPaso y esPrincipal no se contradicen', () => {
    for (const p of PASOS) {
      expect(esPaso(p)).toBe(true)
      expect(esPrincipal(p)).toBe(!esDeSeguimiento(p))
    }
  })
})

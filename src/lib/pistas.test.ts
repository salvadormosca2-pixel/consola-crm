import { describe, expect, it } from 'vitest'

import {
  consumeCupo,
  esApertura,
  esPaso,
  estaRetirado,
  PASO_META,
  PASOS,
  PASOS_DE_PISTA,
  PASOS_QUE_CONSUMEN_CUPO,
  PASOS_RETIRADOS,
  PISTA_META,
  PISTAS,
  PISTAS_POR_ZONA,
  pistaDePaso,
  primerPasoDe,
  SECCION_META,
  SECCIONES,
  seccionDePaso,
  siguienteDeLaPista,
  ubicacionDePaso,
  ZONAS,
  type Paso,
} from './pistas'

/**
 * El modelo del recorrido.
 *
 * Casi nada de esto se prueba caso por caso: lo que se cuida son las
 * propiedades que, si se rompen, no fallan con un error sino en silencio —
 * dejando leads parados en un paso que no existe o mandándoles el mensaje de
 * otra situación. Eso no lo nota nadie hasta que se pierde el lead.
 */

describe('los números de paso', () => {
  it('ningún número pertenece a dos pistas', () => {
    const vistos = new Set<Paso>()
    for (const pista of PISTAS) {
      for (const p of PISTA_META[pista].pasos) {
        expect(vistos.has(p.paso), `el paso ${p.paso} está en dos pistas`).toBe(false)
        vistos.add(p.paso)
      }
    }
  })

  it('un paso en uso nunca es además un retirado', () => {
    // Reusar un número haría que un envío viejo diga que se mandó otra cosa.
    for (const p of PASOS_DE_PISTA) {
      expect(estaRetirado(p), `el paso ${p} está retirado y en uso a la vez`).toBe(false)
    }
  })

  it('los retirados no están en ninguna pista, pero siguen teniendo etiqueta', () => {
    // El historial muestra envíos de hace meses: sin etiqueta, esa pantalla
    // revienta al toparse con uno.
    for (const p of PASOS_RETIRADOS) {
      expect(pistaDePaso(p)).toBeNull()
      expect(PASO_META[p].label.length).toBeGreaterThan(0)
    }
  })

  it('los trece pasos del modelo viejo siguen reservados', () => {
    /*
     * La oferta, los reenganches sueltos, los tres que salían al marcar qué
     * contestó el lead, la escalera del tibio y los dos reintentos. Hay envíos
     * guardados que los apuntan: si alguno se reusara, el historial pasaría a
     * decir que se mandó un mensaje que nunca se mandó.
     */
    expect([...PASOS_RETIRADOS].sort((a, b) => a - b)).toEqual([
      2, 4, 5, 6, 7, 8, 9, 13, 14, 15, 16, 17, 18,
    ])
  })

  it('todo paso declarado existe, y todo paso usado está declarado', () => {
    for (const p of [...PASOS_DE_PISTA, ...PASOS_RETIRADOS]) {
      expect(esPaso(p), `${p} no está en PASOS`).toBe(true)
    }
    for (const p of PASOS) expect(PASO_META[p]).toBeDefined()
  })

  it('los números están cubiertos sin huecos: en una pista o retirados', () => {
    for (const p of PASOS) {
      const clasificaciones = [pistaDePaso(p) !== null, estaRetirado(p)].filter(Boolean).length
      expect(clasificaciones, `el paso ${p} no cae en exactamente un lugar`).toBe(1)
    }
  })
})

describe('la escalera', () => {
  it('cada pista tiene sus escalones numerados 1..N sin saltos', () => {
    for (const pista of PISTAS) {
      const ordenes = PISTA_META[pista].pasos.map((p) => p.orden)
      expect(ordenes).toEqual(ordenes.map((_, i) => i + 1))
    }
  })

  it('un seguimiento es una escalera, no un mensaje', () => {
    // Si el seguimiento vuelve a tener un solo paso, dejó de ser una secuencia
    // y pasa a ser el mismo mensaje repetido.
    expect(PISTA_META.seguimiento.pasos.length).toBeGreaterThanOrEqual(4)
  })

  it('siguienteDeLaPista recorre y corta en el último', () => {
    for (const pista of PISTAS) {
      const pasos = PISTA_META[pista].pasos
      for (let i = 0; i < pasos.length - 1; i += 1) {
        expect(siguienteDeLaPista(pasos[i]!.paso)?.paso).toBe(pasos[i + 1]!.paso)
      }
      expect(siguienteDeLaPista(pasos[pasos.length - 1]!.paso)).toBeNull()
    }
  })

  it('primerPasoDe devuelve el escalón 1 de cada pista', () => {
    for (const pista of PISTAS) expect(primerPasoDe(pista).orden).toBe(1)
  })

  it('los escalones del seguimiento esperan de verdad', () => {
    // Dos toques el mismo día es un toque repetido, no una secuencia.
    for (const p of PISTA_META.seguimiento.pasos) {
      expect(p.diasDefault, `seguimiento/${p.orden} no espera nada`).toBeGreaterThan(0)
    }
  })

  it('los días crecen a lo largo de la escalera', () => {
    // Insistir cada vez más seguido es la forma más rápida de que te bloqueen.
    const dias = PISTA_META.seguimiento.pasos.map((p) => p.diasDefault)
    for (let i = 1; i < dias.length; i += 1) {
      expect(dias[i]!, `el escalón ${i + 1} no espera más que el anterior`).toBeGreaterThan(
        dias[i - 1]!,
      )
    }
  })

  it('el primer mensaje no espera: sale en el acto', () => {
    for (const p of PISTA_META.primer_contacto.pasos) expect(p.diasDefault).toBe(0)
  })

  it('el primer contacto es un solo mensaje', () => {
    // Era entrada + oferta. La oferta se fue con las plantillas: ahora lo que
    // se dice en el primer mensaje se escribe lead por lead.
    expect(PISTA_META.primer_contacto.pasos.map((p) => p.paso)).toEqual([1])
  })
})

describe('el cupo', () => {
  it('solo el primer mensaje lo gasta', () => {
    // Es la diferencia que la pantalla tiene que marcar: en el seguimiento el
    // chat ya está abierto y un toque más no arriesga la cuenta.
    expect(consumeCupo(primerPasoDe('primer_contacto').paso)).toBe(true)
    for (const p of PISTA_META.seguimiento.pasos) expect(consumeCupo(p.paso)).toBe(false)
  })

  it('el que gasta cupo es uno solo', () => {
    expect([...PASOS_QUE_CONSUMEN_CUPO]).toEqual([1])
  })
})

describe('las dos secciones del setter', () => {
  /*
   * Lo que separa las dos listas de la app del celular. Se rompe en silencio:
   * si un paso cae en la lista equivocada nadie ve un error, el setter ve un
   * desconocido adentro de "Seguimiento" y le escribe como si ya hubieran
   * hablado.
   */

  it('abrir el chat y gastar cupo son el mismo hecho', () => {
    // Si estos dos se separaran, el cupo diría una cosa y la pantalla otra.
    for (const p of PASOS) expect(esApertura(p)).toBe(consumeCupo(p))
  })

  it('la única apertura es el primer mensaje', () => {
    expect(PASOS.filter(esApertura)).toEqual([1])
  })

  it('la escalera entera cae en seguimiento', () => {
    for (const p of PISTA_META.seguimiento.pasos) {
      expect(seccionDePaso(p.paso)).toBe('seguimiento')
    }
  })

  it('todo paso cae en una sección', () => {
    for (const p of PASOS) expect(SECCIONES).toContain(seccionDePaso(p))
  })

  it('cada sección tiene nombre escrito: es lo que lee el setter', () => {
    for (const s of SECCIONES) {
      expect(SECCION_META[s].titulo.length).toBeGreaterThan(0)
      expect(SECCION_META[s].corto.length).toBeGreaterThan(0)
      expect(SECCION_META[s].detalle.length).toBeGreaterThan(0)
    }
  })
})

describe('las zonas del panel', () => {
  it('ninguna zona queda sin pistas y ninguna pista sin zona', () => {
    const enZonas = ZONAS.flatMap((z) => [...PISTAS_POR_ZONA[z]])
    expect([...enZonas].sort()).toEqual([...PISTAS].sort())
    for (const z of ZONAS) expect(PISTAS_POR_ZONA[z].length).toBeGreaterThan(0)
    for (const pista of PISTAS) {
      expect(PISTAS_POR_ZONA[PISTA_META[pista].zona]).toContain(pista)
    }
  })
})

describe('ubicacionDePaso', () => {
  it('ubica cada escalón en su pista y su orden', () => {
    for (const pista of PISTAS) {
      for (const p of PISTA_META[pista].pasos) {
        expect(ubicacionDePaso(p.paso)).toEqual({ pista, paso: p })
      }
    }
  })

  it('no ubica lo que no es de una pista', () => {
    for (const p of PASOS_RETIRADOS) expect(ubicacionDePaso(p)).toBeNull()
  })
})

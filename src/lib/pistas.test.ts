import { describe, expect, it } from 'vitest'

import {
  consumeCupo,
  PASOS_QUE_CONSUMEN_CUPO,
  esApertura,
  esPaso,
  estaRetirado,
  GRUPOS_DE_MENSAJES,
  PASO_META,
  PASOS,
  PASOS_DE_MARCA,
  PASOS_DE_MENSAJES,
  PASOS_DE_PISTA,
  PASOS_RETIRADOS,
  PISTA_META,
  PISTAS,
  PISTAS_POR_ZONA,
  pistaDePaso,
  primerPasoDe,
  seEscribeEnMensajes,
  seccionDePaso,
  SECCIONES,
  SECCION_META,
  siguienteDeLaPista,
  ubicacionDePaso,
  ZONAS,
  type Paso,
} from './pistas'

/**
 * El modelo de pistas.
 *
 * Casi nada de esto se prueba caso por caso: lo que se cuida son las
 * propiedades que, si se rompen, no fallan con un error sino en silencio —
 * dejando leads parados en un paso sin texto o mandándoles el mensaje de otra
 * situación. Eso no lo nota nadie hasta que se pierde el lead.
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

  it('un paso de pista nunca es también una marca ni un retirado', () => {
    // Reusar un número haría que un envío viejo diga que se mandó otra cosa.
    for (const p of PASOS_DE_PISTA) {
      expect((PASOS_DE_MARCA as readonly number[]).includes(p)).toBe(false)
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

  it('todo paso declarado existe, y todo paso usado está declarado', () => {
    for (const p of [...PASOS_DE_PISTA, ...PASOS_DE_MARCA, ...PASOS_RETIRADOS]) {
      expect(esPaso(p), `${p} no está en PASOS`).toBe(true)
    }
    for (const p of PASOS) expect(PASO_META[p]).toBeDefined()
  })

  it('los números están cubiertos sin huecos: pista, marca o retirado', () => {
    for (const p of PASOS) {
      const clasificaciones = [
        pistaDePaso(p) !== null,
        (PASOS_DE_MARCA as readonly number[]).includes(p),
        estaRetirado(p),
      ].filter(Boolean).length
      expect(clasificaciones, `el paso ${p} no cae en exactamente un lugar`).toBe(1)
    }
  })
})

describe('las escaleras', () => {
  it('cada pista tiene sus escalones numerados 1..N sin saltos', () => {
    for (const pista of PISTAS) {
      const ordenes = PISTA_META[pista].pasos.map((p) => p.orden)
      expect(ordenes).toEqual(ordenes.map((_, i) => i + 1))
    }
  })

  it('un seguimiento es una escalera, no un mensaje', () => {
    // La corrección de fondo del modelo. Si alguna de las dos pistas reales
    // vuelve a tener un solo paso, dejó de ser una secuencia.
    expect(PISTA_META.silencio.pasos.length).toBeGreaterThanOrEqual(4)
    expect(PISTA_META.tibio.pasos.length).toBeGreaterThanOrEqual(4)
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

  it('los escalones de una pista de espera esperan de verdad', () => {
    // Dos toques el mismo día es un toque repetido, no una secuencia.
    for (const pista of PISTAS) {
      if (pista === 'primer_contacto') continue
      for (const p of PISTA_META[pista].pasos) {
        expect(p.diasDefault, `${pista}/${p.orden} no espera nada`).toBeGreaterThan(0)
      }
    }
  })

  it('los días crecen a lo largo de cada escalera', () => {
    // Insistir cada vez más seguido es la forma más rápida de que te bloqueen.
    // La apertura queda afuera: sus dos pasos salen en el acto, los dos en 0.
    for (const pista of PISTAS) {
      if (pista === 'primer_contacto') continue
      const dias = PISTA_META[pista].pasos.map((p) => p.diasDefault)
      for (let i = 1; i < dias.length; i += 1) {
        expect(dias[i]!, `${pista}: el escalón ${i + 1} no espera más que el anterior`)
          .toBeGreaterThan(dias[i - 1]!)
      }
    }
  })

  it('el primer contacto no espera: los dos salen en el acto', () => {
    for (const p of PISTA_META.primer_contacto.pasos) expect(p.diasDefault).toBe(0)
  })
})

describe('el cupo', () => {
  it('solo la apertura y el reintento lo gastan', () => {
    // Es la diferencia que la pantalla tiene que marcar: en las dos pistas de
    // seguimiento el chat ya está abierto y un toque más no arriesga la cuenta.
    expect(consumeCupo(primerPasoDe('primer_contacto').paso)).toBe(true)
    expect(consumeCupo(primerPasoDe('sin_abrir').paso)).toBe(true)
    expect(consumeCupo(primerPasoDe('silencio').paso)).toBe(false)
    expect(consumeCupo(primerPasoDe('tibio').paso)).toBe(false)
  })

  it('la oferta NO lo gasta, aunque viva en la pista que abre chats', () => {
    // Sale cuando el lead acaba de contestar la entrada: el chat está abierto y
    // hay alguien escribiendo del otro lado. Contarla dejaba al setter sin
    // poder responderle justo cuando más importa — y bloqueada por un límite
    // que existe para otra cosa.
    expect(consumeCupo(2)).toBe(false)
    expect(PASOS_QUE_CONSUMEN_CUPO).not.toContain(2)
  })

  it('el reintento se corta en dos intentos', () => {
    expect(PISTA_META.sin_abrir.pasos.length).toBe(2)
  })
})

describe('las dos secciones del setter', () => {
  /*
   * Lo que separa las dos listas de la app del celular. Se rompe en silencio:
   * si un paso cae en la lista equivocada nadie ve un error, el setter ve un
   * desconocido adentro de "Seguimiento" y le escribe como si ya hubieran
   * hablado. Es exactamente lo que pasaba cuando la pantalla lo decidía con un
   * `paso > 1`.
   */

  it('abrir el chat y gastar cupo son el mismo hecho', () => {
    // Si estos dos se separaran, el cupo diría una cosa y la pantalla otra.
    for (const p of PASOS) expect(esApertura(p)).toBe(consumeCupo(p))
  })

  it('las aperturas son la entrada y los dos reintentos, y nada más', () => {
    const aperturas = PASOS.filter(esApertura).sort((a, b) => a - b)
    expect(aperturas).toEqual([1, ...PISTA_META.sin_abrir.pasos.map((x) => x.paso)])
  })

  it('la oferta y las marcas son seguimiento: el chat ya está abierto', () => {
    // Los cuatro que estaban del lado equivocado. La oferta sale cuando el lead
    // acaba de contestar, y las tres marcas cuando el setter registra qué dijo.
    for (const p of [2, ...PASOS_DE_MARCA]) expect(seccionDePaso(p)).toBe('seguimiento')
  })

  it('las dos pistas de seguimiento caen enteras en seguimiento', () => {
    for (const pista of ['silencio', 'tibio'] as const) {
      for (const p of PISTA_META[pista].pasos) expect(seccionDePaso(p.paso)).toBe('seguimiento')
    }
  })

  it('todo paso cae en una sección y en una sola', () => {
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

describe('el reparto entre las dos pantallas', () => {
  it('cada paso vivo se escribe en una pantalla, y en una sola', () => {
    const enPistas = PASOS_DE_PISTA.filter((p) => !seEscribeEnMensajes(p))
    const enMensajes = PASOS_DE_MENSAJES
    for (const p of [...PASOS_DE_PISTA, ...PASOS_DE_MARCA]) {
      const veces = [enPistas.includes(p), enMensajes.includes(p)].filter(Boolean).length
      expect(veces, `el paso ${p} no tiene exactamente una pantalla`).toBe(1)
    }
  })

  it('Mensajes se queda con la apertura y las marcas, y con nada más', () => {
    expect([...PASOS_DE_MENSAJES].sort((a, b) => a - b)).toEqual([1, 2, 6, 7, 8])
  })

  it('los grupos de Mensajes cubren exactamente sus pasos', () => {
    const enGrupos = GRUPOS_DE_MENSAJES.flatMap((g) => [...g.pasos]).sort((a, b) => a - b)
    expect(enGrupos).toEqual([...PASOS_DE_MENSAJES].sort((a, b) => a - b))
  })

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
    for (const p of [...PASOS_DE_MARCA, ...PASOS_RETIRADOS]) {
      expect(ubicacionDePaso(p)).toBeNull()
    }
  })
})

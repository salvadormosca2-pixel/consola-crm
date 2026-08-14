import { describe, expect, it } from 'vitest'

import {
  detectarArea,
  formatearTelefono,
  normalizarInstagram,
  normalizarTelefonoAr,
} from './phone-ar'

/** Atajo: devuelve el E.164 o null si no se pudo normalizar. */
function e164(crudo: unknown): string | null {
  const r = normalizarTelefonoAr(crudo as string)
  return r.ok ? r.e164 : null
}

function motivo(crudo: unknown): string | null {
  const r = normalizarTelefonoAr(crudo as string)
  return r.ok ? null : r.motivo
}

describe('normalizarTelefonoAr — los cuatro casos del criterio de aceptación', () => {
  // Los cuatro tienen que dar exactamente el mismo resultado.
  const esperado = '5493834567890'

  it('0383 15 456 7890', () => expect(e164('0383 15 456 7890')).toBe(esperado))
  it('+54 383 456-7890', () => expect(e164('+54 383 456-7890')).toBe(esperado))
  it('383154567890', () => expect(e164('383154567890')).toBe(esperado))
  it('3834567890', () => expect(e164('3834567890')).toBe(esperado))

  it('los cuatro convergen al mismo número', () => {
    const formas = ['0383 15 456 7890', '+54 383 456-7890', '383154567890', '3834567890']
    expect(new Set(formas.map(e164))).toEqual(new Set([esperado]))
  })
})

describe('normalizarTelefonoAr — formas que llegan en los Excel', () => {
  const equivalentes: Array<[string, string]> = [
    ['+5493834567890', '5493834567890'],
    ['5493834567890', '5493834567890'],
    ['549 383 456 7890', '5493834567890'],
    ['0054 9 383 456 7890', '5493834567890'],
    ['(0383) 15-456-7890', '5493834567890'],
    ['0383-15-4567890', '5493834567890'],
    ['383 15 456 7890', '5493834567890'],
    ['  3834567890  ', '5493834567890'],
    ['383.456.7890', '5493834567890'],
    ['54 9 383 456 7890', '5493834567890'],
  ]

  for (const [entrada, salida] of equivalentes) {
    it(`«${entrada}» → ${salida}`, () => expect(e164(entrada)).toBe(salida))
  }

  it('acepta el número como número, no solo como texto', () => {
    // Excel convierte a número las columnas que parecen numéricas y se come
    // el cero de adelante.
    expect(e164(3834567890)).toBe('5493834567890')
  })
})

describe('normalizarTelefonoAr — códigos de área de distinto largo', () => {
  it('Buenos Aires, área de 2 dígitos', () => {
    expect(e164('011 15 5555 5555')).toBe('5491155555555')
    expect(e164('1155555555')).toBe('5491155555555')
    expect(e164('+54 11 5555-5555')).toBe('5491155555555')
  })

  it('capital de provincia, área de 3 dígitos', () => {
    expect(e164('0351 15 555 5555')).toBe('5493515555555') // Córdoba
    expect(e164('0341 15 444 4444')).toBe('5493414444444') // Rosario
  })

  it('interior, área de 4 dígitos', () => {
    // 2954 (Santa Rosa): 4 de área + 6 de abonado = 10.
    expect(e164('02954 15 456789')).toBe('5492954456789')
    expect(e164('2954456789')).toBe('5492954456789')
  })

  it('resuelve el 15 aunque el área de 4 empiece con un área de 3 válida', () => {
    // 383 (Catamarca capital) es prefijo de 3837 (Andalgalá). Sacar el 15
    // probando solo el corte de 3 dígitos daría un número equivocado.
    expect(e164('03837 15 456789')).toBe('5493837456789')
    // Y el mismo número sin el 15 tiene que dar igual.
    expect(e164('3837456789')).toBe('5493837456789')
  })

  it('el 15 se saca del lugar correcto según el largo del área', () => {
    // Si se borrara "el primer 15 que aparezca", este número quedaría mal:
    // el 15 del medio es parte del abonado.
    expect(e164('0351 15 155 5555')).toBe('5493511555555')
  })

  it('detectarArea reconoce los tres largos', () => {
    expect(detectarArea('1155555555')).toBe('11')
    expect(detectarArea('3834567890')).toBe('383')
    expect(detectarArea('2954456789')).toBe('2954')
  })

  it('ante un prefijo ambiguo prefiere el área de 3 dígitos', () => {
    // 383 es prefijo de 3837 y sin la tabla de prefijos de abonado no se puede
    // desambiguar. Solo afecta lo que se muestra, no el número que se manda.
    expect(detectarArea('3837456789')).toBe('383')
    expect(e164('3837456789')).toBe('5493837456789')
  })
})

describe('normalizarTelefonoAr — lo que tiene que ir a Revisar', () => {
  it('vacío', () => {
    expect(motivo('')).toBe('vacio')
    expect(motivo(null)).toBe('vacio')
    expect(motivo('   ')).toBe('vacio')
  })

  it('texto sin dígitos', () => {
    expect(motivo('no tiene')).toBe('sin_digitos')
    expect(motivo('-')).toBe('sin_digitos')
  })

  it('demasiado corto', () => {
    expect(motivo('1234')).toBe('corto')
    expect(motivo('456 7890')).toBe('corto')
  })

  it('demasiado largo', () => {
    expect(motivo('38345678901234')).toBe('largo')
  })

  it('un 15 sin código de área no se puede resolver', () => {
    // Es el caso de "anotame el 15 1234 5678": falta saber de qué ciudad es.
    expect(motivo('15 1234 5678')).toBe('sin_codigo_de_area')
    expect(motivo('1512345678')).toBe('sin_codigo_de_area')
  })

  it('un código de área que no existe', () => {
    // Los códigos argentinos empiezan con 1, 2 o 3.
    expect(motivo('9994567890')).toBe('area_invalida')
    expect(motivo('4444567890')).toBe('area_invalida')
  })

  it('cada rechazo trae un motivo legible, no un código suelto', () => {
    for (const malo of ['', 'x', '1234', '1512345678', '9994567890']) {
      const r = normalizarTelefonoAr(malo)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.detalle.length).toBeGreaterThan(15)
    }
  })
})

describe('normalizarTelefonoAr — números de otros países', () => {
  it('respeta un número extranjero con + y no lo fuerza a formato argentino', () => {
    const r = normalizarTelefonoAr('+1 555 123 4567')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.e164).toBe('15551234567')
      expect(r.extranjero).toBe(true)
    }
  })

  it('reconoce un uruguayo', () => {
    const r = normalizarTelefonoAr('+598 99 123 456')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.extranjero).toBe(true)
  })

  it('un argentino con + no queda marcado como extranjero', () => {
    const r = normalizarTelefonoAr('+54 9 383 456 7890')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.extranjero).toBe(false)
  })

  it('un extranjero demasiado corto se rechaza', () => {
    expect(motivo('+1 555')).toBe('corto')
  })
})

describe('normalizarTelefonoAr — es idempotente', () => {
  it('normalizar dos veces da lo mismo', () => {
    for (const entrada of ['0383 15 456 7890', '011 15 5555 5555', '3837456789']) {
      const una = e164(entrada)
      expect(una).not.toBeNull()
      expect(e164(una!)).toBe(una)
    }
  })
})

describe('formatearTelefono', () => {
  it('muestra el número de forma legible', () => {
    expect(formatearTelefono('5493834567890')).toBe('+54 9 383 456-7890')
    expect(formatearTelefono('5491155555555')).toBe('+54 9 11 5555-5555')
  })

  it('no rompe con un número que no es argentino', () => {
    expect(formatearTelefono('15551234567')).toBe('+15551234567')
  })

  it('devuelve un guion si no hay número', () => {
    expect(formatearTelefono(null)).toBe('—')
    expect(formatearTelefono('')).toBe('—')
  })
})

describe('normalizarInstagram', () => {
  it('las tres formas del criterio de aceptación dan lo mismo', () => {
    const formas = ['@Usuario', 'instagram.com/usuario/', 'Usuario ']
    const salidas = formas.map((f) => {
      const r = normalizarInstagram(f)
      return r.ok ? r.usuario : null
    })
    expect(new Set(salidas)).toEqual(new Set(['usuario']))
  })

  it('limpia todas las variantes de URL', () => {
    const urls = [
      'https://www.instagram.com/MiNegocio/',
      'http://instagram.com/minegocio',
      'instagram.com/minegocio/?hl=es',
      'www.instagram.com/minegocio',
      '@@minegocio',
      '  @MiNegocio  ',
    ]
    for (const u of urls) {
      const r = normalizarInstagram(u)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.usuario).toBe('minegocio')
    }
  })

  it('conserva puntos y guiones bajos, que Instagram permite', () => {
    const r = normalizarInstagram('@mi.negocio_ok')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.usuario).toBe('mi.negocio_ok')
  })

  it('rechaza lo que Instagram no permite', () => {
    // El guion medio no lo permite Instagram; el numeral sí se corta como
    // fragmento de URL, así que no va en esta lista.
    for (const malo of ['mi negocio!', 'mi-negocio', 'a'.repeat(31), '¿que?']) {
      expect(normalizarInstagram(malo).ok).toBe(false)
    }
  })

  it('se queda con el usuario aunque venga con path pegado', () => {
    // Todo lo que viene después de una barra es ruido de URL, no parte del usuario.
    const r = normalizarInstagram('minegocio/reels')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.usuario).toBe('minegocio')
  })

  it('rechaza el vacío', () => {
    expect(normalizarInstagram('').ok).toBe(false)
    expect(normalizarInstagram('@').ok).toBe(false)
    expect(normalizarInstagram(null).ok).toBe(false)
  })

  it('es idempotente', () => {
    const r = normalizarInstagram('@Usuario')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const otra = normalizarInstagram(r.usuario)
      expect(otra.ok && otra.usuario).toBe('usuario')
    }
  })
})

import { randomBytes } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { _resetClave, cifrar, comparaSeguro, descifrar, enmascarar, generarSecreto } from './crypto'

const CLAVE_A = randomBytes(32).toString('base64')
const CLAVE_B = randomBytes(32).toString('base64')

beforeEach(() => {
  process.env.ENCRYPTION_KEY = CLAVE_A
  _resetClave()
})

afterEach(() => {
  delete process.env.ENCRYPTION_KEY
  _resetClave()
})

describe('cifrar y descifrar', () => {
  it('devuelve el mismo texto que entró', () => {
    const token = 'cw_pat_9f3a2b1c8d7e6f5a4b3c2d1e0f9a8b7c'
    expect(descifrar(cifrar(token))).toBe(token)
  })

  it('cifra bien un token con acentos y símbolos', () => {
    const raro = 'ñandú-Ω-🔑-"comillas"-\\barra'
    expect(descifrar(cifrar(raro))).toBe(raro)
  })

  it('dos cifrados del mismo texto dan valores distintos', () => {
    // Si el IV se repitiera, dos tokens iguales serían reconocibles en la base.
    const a = cifrar('mismo-token')
    const b = cifrar('mismo-token')
    expect(a).not.toBe(b)
    expect(descifrar(a)).toBe(descifrar(b))
  })

  it('el valor guardado no contiene el texto original', () => {
    const cifrado = cifrar('token-secreto-visible')
    expect(cifrado).not.toContain('token-secreto')
    expect(Buffer.from(cifrado, 'utf8').includes('secreto')).toBe(false)
  })

  it('falla si el valor fue alterado en la base', () => {
    const cifrado = cifrar('token')
    const partes = cifrado.split('.')
    // Se cambia un carácter de los datos.
    const datos = partes[3]!
    partes[3] = (datos[0] === 'A' ? 'B' : 'A') + datos.slice(1)
    expect(() => descifrar(partes.join('.'))).toThrow(/alterado|corrupto|descifrar/)
  })

  it('falla si el tag de autenticación fue alterado', () => {
    const partes = cifrar('token').split('.')
    partes[2] = Buffer.from(randomBytes(16)).toString('base64url')
    expect(() => descifrar(partes.join('.'))).toThrow()
  })

  it('falla con una clave distinta y lo dice claro', () => {
    const cifrado = cifrar('token')
    process.env.ENCRYPTION_KEY = CLAVE_B
    _resetClave()
    expect(() => descifrar(cifrado)).toThrow(/ENCRYPTION_KEY/)
  })

  it('rechaza un formato que no reconoce', () => {
    expect(() => descifrar('texto-plano')).toThrow(/formato/)
    expect(() => descifrar('v2.a.b.c')).toThrow(/formato/)
  })

  it('no deja cifrar una cadena vacía', () => {
    expect(() => cifrar('')).toThrow()
  })
})

describe('validación de la clave', () => {
  it('avisa si falta ENCRYPTION_KEY y dice cómo generarla', () => {
    delete process.env.ENCRYPTION_KEY
    _resetClave()
    expect(() => cifrar('x')).toThrow(/randomBytes\(32\)/)
  })

  it('rechaza una clave que no sea de 32 bytes', () => {
    process.env.ENCRYPTION_KEY = Buffer.from('corta').toString('base64')
    _resetClave()
    expect(() => cifrar('x')).toThrow(/32 bytes/)
  })
})

describe('comparaSeguro', () => {
  it('reconoce dos secretos iguales', () => {
    const s = generarSecreto()
    expect(comparaSeguro(s, s)).toBe(true)
  })

  it('rechaza secretos distintos del mismo largo', () => {
    expect(comparaSeguro('a'.repeat(32), 'b'.repeat(32))).toBe(false)
  })

  it('rechaza secretos de largo distinto sin explotar', () => {
    expect(comparaSeguro('corto', 'muchisimo-mas-largo')).toBe(false)
  })

  it('rechaza el vacío contra un secreto real', () => {
    expect(comparaSeguro('', generarSecreto())).toBe(false)
  })
})

describe('generarSecreto', () => {
  it('genera secretos distintos cada vez', () => {
    const vistos = new Set(Array.from({ length: 50 }, () => generarSecreto()))
    expect(vistos.size).toBe(50)
  })

  it('tiene largo suficiente para un webhook', () => {
    expect(generarSecreto().length).toBeGreaterThanOrEqual(40)
  })
})

describe('enmascarar', () => {
  it('deja ver las puntas y esconde el medio', () => {
    expect(enmascarar('cw_pat_1234567890abcdef')).toBe('cw_p…cdef')
  })

  it('esconde entero un secreto corto', () => {
    expect(enmascarar('corto')).toBe('••••')
  })
})

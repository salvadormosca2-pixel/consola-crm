import { describe, expect, it } from 'vitest'

import { etiquetaCorta } from './cap-meter'

describe('etiquetaCorta', () => {
  it('saca el prefijo de canal, que ya lo dice el grupo', () => {
    expect(etiquetaCorta('WA-01')).toBe('01')
    expect(etiquetaCorta('IG-01')).toBe('01')
    expect(etiquetaCorta('wa_07')).toBe('07')
  })

  it('se queda con los dos últimos caracteres de un código largo', () => {
    expect(etiquetaCorta('VENTAS-12')).toBe('12')
  })

  it('no devuelve vacío cuando el código es solo el prefijo', () => {
    expect(etiquetaCorta('WA')).toBe('WA')
    expect(etiquetaCorta('IG')).toBe('IG')
  })
})

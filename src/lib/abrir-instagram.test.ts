import { describe, expect, it } from 'vitest'

import { hrefDeInstagram, plataformaDe, usuarioDelLink } from './abrir-instagram'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

describe('plataformaDe', () => {
  it('reconoce Android', () => {
    expect(plataformaDe(ANDROID)).toBe('android')
  })

  it('reconoce iPhone y iPad', () => {
    expect(plataformaDe(IPHONE)).toBe('ios')
    expect(plataformaDe('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)')).toBe('ios')
  })

  it('lo demás es escritorio', () => {
    expect(plataformaDe(MAC)).toBe('escritorio')
  })
})

describe('usuarioDelLink', () => {
  it('saca el usuario del link de chat directo', () => {
    expect(usuarioDelLink('https://ig.me/m/panaderia.norte')).toBe('panaderia.norte')
  })

  it('saca el usuario del link de perfil', () => {
    expect(usuarioDelLink('https://www.instagram.com/panaderia_norte/')).toBe('panaderia_norte')
  })

  it('devuelve null cuando el link no es de Instagram', () => {
    expect(usuarioDelLink('https://ejemplo.com/panaderia')).toBeNull()
    expect(usuarioDelLink('')).toBeNull()
  })
})

describe('hrefDeInstagram', () => {
  const link = 'https://ig.me/m/panaderia.norte'

  it('en Android exige la app de Instagram por su paquete', () => {
    const href = hrefDeInstagram(link, 'android')
    expect(href).toContain('intent://ig.me/m/panaderia.norte')
    expect(href).toContain('package=com.instagram.android')
  })

  it('en Android deja el link común de respaldo si no está la app', () => {
    expect(hrefDeInstagram(link, 'android')).toContain(
      `S.browser_fallback_url=${encodeURIComponent(link)}`,
    )
  })

  it('en iOS y escritorio va el link tal cual', () => {
    expect(hrefDeInstagram(link, 'ios')).toBe(link)
    expect(hrefDeInstagram(link, 'escritorio')).toBe(link)
  })

  it('un link que no es de Instagram no se toca', () => {
    const otro = 'https://ejemplo.com/algo'
    expect(hrefDeInstagram(otro, 'android')).toBe(otro)
  })
})

/**
 * Abrir el chat de Instagram desde el celular, **en la app y no en el navegador**.
 *
 * El problema que esto resuelve es el que se veía en la calle: el primer toque
 * abría Instagram y el segundo caía en Chrome o Safari. No era del teléfono,
 * eran dos aperturas por un solo toque.
 *
 *   · `window.open(url, '_blank', 'noopener,noreferrer')` devuelve `null`
 *     **siempre** que se le pasa `noopener` — así está en la especificación, no
 *     es una falla del celular. El código de antes leía ese `null` como "no se
 *     pudo abrir" y disparaba el respaldo, así que cada toque abría el chat dos
 *     veces: la primera se la llevaba la app, y la segunda —que ya venía de
 *     `ig.me`— se quedaba en el navegador.
 *
 *   · Y aunque abriera una sola vez, `window.open` tampoco sirve: ni Android ni
 *     iOS le entregan un link a la app cuando la navegación la arrancó un
 *     script. El gesto que sí reconocen es un click sobre un `<a href>` de
 *     verdad. Por eso ya no se abre nada desde código: acá solo se decide **a
 *     dónde** apunta el enlace, y el que abre es `AbrirInstagram`.
 *
 * En Android hay una forma de exigir la app y no pedirla: `intent://`, con el
 * paquete de Instagram adentro. Si la app no está instalada, el propio Android
 * manda al `browser_fallback_url`. En iOS no existe equivalente y el que
 * resuelve es el link común de `ig.me`, que el sistema intercepta como
 * Universal Link cuando el toque es sobre un enlace.
 */

/** El paquete de la app de Instagram en Android. */
const PAQUETE_ANDROID = 'com.instagram.android'

export type Plataforma = 'android' | 'ios' | 'escritorio'

/** Qué teléfono es, mirando el `user agent`. Separado para poder probarlo. */
export function plataformaDe(ua: string): Plataforma {
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  return 'escritorio'
}

/**
 * La plataforma de quien está mirando.
 *
 * El iPad moderno miente y se presenta como una Mac: lo delata que tenga
 * pantalla táctil, que ninguna Mac tiene.
 */
export function plataformaActual(): Plataforma {
  if (typeof navigator === 'undefined') return 'escritorio'

  const p = plataformaDe(navigator.userAgent)
  if (p !== 'escritorio') return p

  const esMac = /Mac/i.test(navigator.userAgent)
  return esMac && navigator.maxTouchPoints > 1 ? 'ios' : 'escritorio'
}

/**
 * El usuario de Instagram que hay adentro de un link nuestro.
 *
 * Los links los arma el servidor (`linksDeInstagram`), así que las dos formas
 * que llegan acá son `ig.me/m/usuario` y `instagram.com/usuario`.
 */
export function usuarioDelLink(url: string): string | null {
  const m = /^https?:\/\/(?:www\.)?(?:ig\.me\/m\/|instagram\.com\/(?:_u\/)?)([A-Za-z0-9._]+)/i.exec(
    url.trim(),
  )
  // `m?.[1]` y no `m[1]`: con `noUncheckedIndexedAccess` el grupo capturado es
  // `string | undefined`, y devolverlo tal cual no compila.
  return m?.[1] ?? null
}

/**
 * A dónde tiene que apuntar el enlace en cada plataforma.
 *
 * Android se lleva el `intent://`, que no deja lugar a dudas: o abre la app de
 * Instagram o, si no está instalada, el link común. iOS y escritorio se llevan
 * el link tal cual.
 */
export function hrefDeInstagram(url: string, plataforma: Plataforma): string {
  if (plataforma !== 'android') return url

  const usuario = usuarioDelLink(url)
  if (!usuario) return url

  return (
    `intent://ig.me/m/${usuario}#Intent;scheme=https;package=${PAQUETE_ANDROID};` +
    `S.browser_fallback_url=${encodeURIComponent(url)};end`
  )
}

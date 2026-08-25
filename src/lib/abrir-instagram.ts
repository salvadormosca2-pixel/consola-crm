/**
 * Abrir el chat de Instagram desde el celular.
 *
 * `window.open` es lo primero que se intenta, pero devuelve `null` cuando el
 * navegador lo toma por una ventana emergente —pasa seguido en el celular, y
 * más todavía con la app instalada como PWA—. Ahí no hay error ni aviso: la
 * llamada simplemente no hace nada y el setter se queda mirando la pantalla.
 *
 * Por eso el respaldo: un enlace de verdad, creado y clickeado. Un click sobre
 * un `<a>` no cuenta como emergente, así que pasa donde `window.open` no pasa.
 */
export function abrirEnInstagram(url: string): void {
  try {
    const ventana = window.open(url, '_blank', 'noopener,noreferrer')
    if (ventana) return
  } catch {
    // Sigue por el respaldo.
  }

  try {
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } catch {
    // Último recurso: salir de la app. Vuelve con el botón de atrás.
    window.location.href = url
  }
}

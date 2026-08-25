/**
 * Copiar al portapapeles, de verdad y sin excusas.
 *
 * Copiar el mensaje **es la función principal de la app**: el setter abre el
 * chat, pega y manda. Si el copiado falla, no hay nada que pegar y todo lo
 * demás sobra. Por eso esto no usa el camino "moderno y limpio" sino el que
 * funciona siempre.
 *
 * Hay dos formas de copiar y ninguna alcanza sola:
 *
 *   · `document.execCommand('copy')` está obsoleto pero es **síncrono**, y eso
 *     es exactamente lo que hace falta acá: corre dentro del toque del dedo,
 *     antes de que la pantalla se vaya a Instagram, y anda sin HTTPS.
 *   · `navigator.clipboard.writeText` es la API buena, pero es asíncrona y
 *     **no existe fuera de un contexto seguro**. Peor: si la promesa se
 *     resuelve después de que el navegador cambió de pestaña, rechaza con
 *     "Document is not focused" y el mensaje nunca llega al portapapeles. Eso
 *     es justo lo que pasa cuando se copia y se abre el chat en el mismo toque.
 *
 * Por eso el orden es el que es: **primero el síncrono**, que resuelve dentro
 * del gesto, y la API moderna solo como respaldo si aquel no pudo.
 */
export function copiarAlPortapapeles(texto: string): Promise<boolean> {
  // Dentro del gesto y antes de cualquier navegación. Si esto anda, listo.
  if (copiarSincronico(texto)) return Promise.resolve(true)

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(texto).then(
      () => true,
      () => false,
    )
  }

  return Promise.resolve(false)
}

/**
 * El método de siempre: un campo fuera de la vista, se selecciona y se copia.
 *
 * Los detalles no son decorativos, cada uno tapa un caso que falla:
 *
 *   · nada de `display:none` ni `visibility:hidden` — un campo oculto así no
 *     se puede seleccionar y no se copia nada;
 *   · nada de `readonly` — iOS ignora la selección sobre un campo de solo
 *     lectura;
 *   · `contentEditable` más un `Range`, que es lo único que iOS respeta;
 *   · `font-size: 16px` para que el navegador no haga zoom al enfocar;
 *   · se restaura el desplazamiento, porque enfocar un campo lo mueve.
 */
function copiarSincronico(texto: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false

  const scrollY = window.scrollY
  const area = document.createElement('textarea')
  area.value = texto
  area.contentEditable = 'true'
  area.readOnly = false
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '0'
  area.style.width = '1px'
  area.style.height = '1px'
  area.style.padding = '0'
  area.style.border = 'none'
  area.style.outline = 'none'
  area.style.boxShadow = 'none'
  area.style.background = 'transparent'
  area.style.fontSize = '16px'
  area.style.opacity = '0'

  document.body.appendChild(area)

  try {
    area.focus()
    area.select()

    // iOS no copia con `select()` a secas: necesita el rango explícito.
    const rango = document.createRange()
    rango.selectNodeContents(area)
    const seleccion = window.getSelection()
    if (seleccion) {
      seleccion.removeAllRanges()
      seleccion.addRange(rango)
    }
    area.setSelectionRange(0, texto.length)

    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(area)
    window.scrollTo(0, scrollY)
  }
}

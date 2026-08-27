import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'

import { adivinarMapeo, mapeoCompleto } from './columns'
import { leerLaHoja, prepararTodo, vistazo } from './hoja'

/**
 * El camino que decide si se importa algo o no se importa nada.
 *
 * Esto no tenía un solo test, y por eso llegó a producción un bug que abría el
 * lote, preparaba **cero filas** y mostraba "0 contactos nuevos" como si fuera
 * un resultado. Se veía la vista previa con las filas y después no entraba
 * ninguna. Nadie se enteró hasta que un usuario lo reportó tres veces.
 *
 * La lección quedó en el primer test de acá: preparar tiene que devolver tantas
 * filas como se vieron en la vista previa. Si esas dos cifras se separan, algo
 * está roto aunque no haya explotado nada.
 */

/** Un Excel armado a mano, para no depender de ningún archivo del repo. */
function excel(filas: string[][]): Uint8Array {
  const hoja = XLSX.utils.aoa_to_sheet(filas)
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, hoja, 'Hoja1')
  return XLSX.write(libro, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

const ENCABEZADOS = ['Negocio', 'Contacto', 'Teléfono', 'Instagram', 'Rubro', 'Ciudad']

function conFilas(...filas: string[][]): Uint8Array {
  return excel([ENCABEZADOS, ...filas])
}

describe('leer la hoja', () => {
  it('separa encabezados de filas y descarta las vacías del final', () => {
    const buffer = conFilas(
      ['Autos del Centro', 'Ana', '3834111111', '', 'concesionaria', 'Catamarca'],
      ['', '', '', '', '', ''],
      ['Rueda Libre', 'Beto', '', '@ruedalibre', 'concesionaria', 'Catamarca'],
    )

    const { encabezados, filas } = leerLaHoja(buffer)
    expect(encabezados).toEqual(ENCABEZADOS)
    // La fila totalmente vacía no cuenta: Excel las agrega solo al final.
    expect(filas).toHaveLength(2)
    expect(filas[0]?.[0]).toBe('Autos del Centro')
  })

  it('un archivo sin filas de datos no rompe, devuelve cero', () => {
    const { filas } = leerLaHoja(excel([ENCABEZADOS]))
    expect(filas).toHaveLength(0)
  })

  it('avisa cuando el archivo está vacío del todo', () => {
    expect(() => leerLaHoja(excel([]))).toThrow(/vac/i)
  })
})

describe('preparar todo', () => {
  it('prepara tantas filas como muestra la vista previa', () => {
    /*
     * **El test que faltaba.** La pantalla cuenta las filas al leer y las vuelve
     * a preparar al importar, en dos pasos distintos. El bug fue justamente que
     * el segundo devolvía cero mientras el primero seguía diciendo 15: si estas
     * dos cifras no coinciden, no se importa nada y nadie se entera.
     */
    const buffer = conFilas(
      ...Array.from({ length: 15 }, (_, i) => [
        `Concesionaria ${i}`,
        `Dueño ${i}`,
        '',
        `@concesionaria${i}`,
        'concesionaria',
        'Catamarca',
      ]),
    )

    const v = vistazo(buffer)
    expect(v.totalFilas).toBe(15)

    const { filas } = prepararTodo(buffer, v.mapeoSugerido)
    expect(filas).toHaveLength(15)
    expect(filas.every((f) => !f.descartada)).toBe(true)
  })

  it('deja lista la fila con todos sus campos normalizados', () => {
    const buffer = conFilas([
      'Autos del Centro',
      'Ana Gómez',
      '(0383) 15-4111111',
      '@autosdelcentro',
      'concesionaria',
      'Catamarca',
    ])

    const { filas } = prepararTodo(buffer, adivinarMapeo(ENCABEZADOS, []))
    const f = filas[0]!

    expect(f.businessName).toBe('Autos del Centro')
    expect(f.contactName).toBe('Ana Gómez')
    // El teléfono sale en E.164, listo para WhatsApp.
    expect(f.phoneE164).toMatch(/^549383/)
    expect(f.hasWhatsapp).toBe(true)
    // El usuario de Instagram, sin arroba.
    expect(f.igUsername).toBe('autosdelcentro')
    expect(f.descartada).toBe(false)
    expect(f.rowNumber).toBe(2) // la 1 es el encabezado, igual que en Excel
  })

  it('un lead solo con Instagram entra igual', () => {
    // Es el caso de una lista scrapeada: no hay teléfono y no hace falta.
    const buffer = conFilas(['Rueda Libre', '', '', '@ruedalibre', 'concesionaria', 'Catamarca'])
    const { filas } = prepararTodo(buffer, adivinarMapeo(ENCABEZADOS, []))

    expect(filas[0]?.descartada).toBe(false)
    expect(filas[0]?.igUsername).toBe('ruedalibre')
    expect(filas[0]?.phoneE164).toBeNull()
  })

  it('la fila sin ningún canal se descarta con el motivo, no se pierde', () => {
    const buffer = conFilas(['Sin Nada', 'Carlos', 'no tengo', '', 'concesionaria', 'Catamarca'])
    const { filas } = prepararTodo(buffer, adivinarMapeo(ENCABEZADOS, []))

    // Sigue estando: va a la pestaña Revisar con el motivo a la vista.
    expect(filas).toHaveLength(1)
    expect(filas[0]?.descartada).toBe(true)
    expect(filas[0]?.avisos.join(' ')).toMatch(/canal/i)
  })

  it('fusiona las filas repetidas del archivo en vez de duplicarlas', () => {
    const buffer = conFilas(
      ['Autos del Centro', 'Ana', '3834111111', '', 'concesionaria', 'Catamarca'],
      // La misma concesionaria, cargada dos veces: una con teléfono y otra con
      // Instagram. Es una sola persona y hay que fusionarlas.
      ['Autos del Centro', '', '3834111111', '@autosdelcentro', '', ''],
    )

    const { filas, duplicadasEnArchivo } = prepararTodo(buffer, adivinarMapeo(ENCABEZADOS, []))

    expect(duplicadasEnArchivo).toBe(1)
    expect(filas).toHaveLength(1)
    // La que queda se llevó el dato que solo traía la otra.
    expect(filas[0]?.igUsername).toBe('autosdelcentro')
  })

  it('no depende de haber leído antes: cada llamada se basta sola', () => {
    /*
     * El worker tenía las filas en memoria entre mensajes y la pantalla lo
     * reiniciaba justo antes de preparar, así que preparaba sobre nada. Ahora
     * el archivo viaja con el pedido; este test fija que preparar no necesite
     * que nadie haya leído antes.
     */
    const buffer = conFilas(['Autos del Centro', 'Ana', '3834111111', '', 'concesionaria', 'Cat.'])
    const mapeo = adivinarMapeo(ENCABEZADOS, [])

    const primera = prepararTodo(buffer, mapeo)
    const segunda = prepararTodo(buffer, mapeo)

    expect(primera.filas).toHaveLength(1)
    expect(segunda.filas).toHaveLength(1)
    expect(segunda.filas[0]?.businessName).toBe(primera.filas[0]?.businessName)
  })

  it('informa el progreso hasta llegar al total', () => {
    const buffer = conFilas(
      ...Array.from({ length: 250 }, (_, i) => [`N ${i}`, '', '', `@n${i}`, '', '']),
    )

    const avances: Array<[number, number]> = []
    prepararTodo(buffer, adivinarMapeo(ENCABEZADOS, []), (hechas, total) =>
      avances.push([hechas, total]),
    )

    expect(avances.length).toBeGreaterThan(1)
    // El último aviso dice que terminó: la barra no se queda a mitad de camino.
    expect(avances.at(-1)).toEqual([250, 250])
  })
})

describe('adivinar el mapeo', () => {
  it('reconoce las columnas por su nombre en castellano', () => {
    const mapeo = adivinarMapeo(ENCABEZADOS, [])
    expect(mapeo.business_name).toBe(0)
    expect(mapeo.phone).toBe(2)
    expect(mapeo.instagram).toBe(3)
    expect(mapeoCompleto(mapeo).ok).toBe(true)
  })

  it('sin la columna del negocio, avisa qué falta en vez de importar mal', () => {
    const sinNegocio = ['Teléfono', 'Rubro']
    const r = mapeoCompleto(adivinarMapeo(sinNegocio, []))
    expect(r.ok).toBe(false)
    expect(r.falta.length).toBeGreaterThan(0)
  })
})

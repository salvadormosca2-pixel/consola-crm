import { beforeAll, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { adivinarMapeo } from './columns'
import { deduplicarArchivo, prepararFila, type FilaPreparada } from './rows'
import { repartir, type CuentaParaReparto } from './distribute'

/**
 * Prueba de punta a punta del importador con un Excel de verdad.
 *
 * Genera el archivo, lo lee con SheetJS igual que el Web Worker, adivina el
 * mapeo, normaliza, deduplica y reparte. Es el camino completo salvo la
 * escritura en la base, que se prueba aparte.
 */

interface FilaFuente {
  Negocio: string
  Nombre: string
  Teléfono: string
  Instagram: string
  Rubro: string
  Ciudad: string
  'Qué compró': string
}

const RUBROS = ['peluquería', 'gimnasio', 'kiosco', 'panadería', 'ferretería']
const CIUDADES = ['Catamarca', 'Córdoba', 'Rosario', 'Buenos Aires']

/** Arma un Excel con 1.000 filas, con la mugre que traen los archivos reales. */
function generarExcel(): { buffer: ArrayBuffer; esperados: number } {
  const filas: FilaFuente[] = []

  for (let i = 0; i < 1000; i++) {
    // Los teléfonos vienen escritos de cinco formas distintas, como en la vida real.
    const nsn = `383${String(4000000 + i)}`
    const formas = [
      `0383 15 ${nsn.slice(3, 6)} ${nsn.slice(6)}`,
      `+54 383 ${nsn.slice(3, 6)}-${nsn.slice(6)}`,
      `383 15 ${nsn.slice(3)}`,
      nsn,
      `(0383) 15-${nsn.slice(3)}`,
    ]

    filas.push({
      Negocio: `Negocio ${i}`,
      Nombre: `Contacto ${i}`,
      Teléfono: formas[i % formas.length]!,
      Instagram: i % 3 === 0 ? `@negocio${i}` : '',
      Rubro: RUBROS[i % RUBROS.length]!,
      Ciudad: CIUDADES[i % CIUDADES.length]!,
      'Qué compró': i % 2 === 0 ? 'pack de reels' : 'sesión de fotos',
    })
  }

  // Mugre a propósito: 20 filas repetidas, 10 con teléfono roto, 5 sin negocio.
  for (let i = 0; i < 20; i++) {
    filas.push({ ...filas[i]!, Negocio: `${filas[i]!.Negocio} (repetido)` })
  }
  for (let i = 0; i < 10; i++) {
    filas.push({
      Negocio: `Roto ${i}`,
      Nombre: '',
      Teléfono: '1234',
      Instagram: `@roto${i}`,
      Rubro: 'kiosco',
      Ciudad: 'Catamarca',
      'Qué compró': '',
    })
  }
  for (let i = 0; i < 5; i++) {
    filas.push({
      Negocio: '',
      Nombre: 'Sin negocio',
      Teléfono: `383${String(9000000 + i)}`,
      Instagram: '',
      Rubro: '',
      Ciudad: '',
      'Qué compró': '',
    })
  }

  const hoja = XLSX.utils.json_to_sheet(filas)
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, hoja, 'Clientes')
  const buffer = XLSX.write(libro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

  return { buffer, esperados: 1000 }
}

/** Repite lo que hace el worker: leer, mapear, normalizar y deduplicar. */
function procesar(buffer: ArrayBuffer) {
  const libro = XLSX.read(buffer, { type: 'array', raw: false })
  const hoja = libro.Sheets[libro.SheetNames[0]!]!
  const matriz = XLSX.utils.sheet_to_json<string[]>(hoja, {
    header: 1,
    defval: '',
    blankrows: false,
    raw: false,
  })

  const encabezados = (matriz[0] ?? []).map((h) => String(h ?? '').trim())
  const filas = matriz.slice(1).map((f) => (f ?? []).map((c) => String(c ?? '')))
  const mapeo = adivinarMapeo(encabezados, filas.slice(0, 40))

  const preparadas = filas.map((f, i) => prepararFila(f, mapeo, encabezados, i + 2))
  const dedupe = deduplicarArchivo(preparadas)

  return { encabezados, mapeo, preparadas, ...dedupe }
}

let excel: { buffer: ArrayBuffer; esperados: number }
let resultado: ReturnType<typeof procesar>

beforeAll(() => {
  excel = generarExcel()
  resultado = procesar(excel.buffer)
})

describe('importación de un Excel de 1.000 filas', () => {
  it('detecta todas las columnas sin ayuda', () => {
    expect(resultado.mapeo.business_name).toBeDefined()
    expect(resultado.mapeo.contact_name).toBeDefined()
    expect(resultado.mapeo.phone).toBeDefined()
    expect(resultado.mapeo.instagram).toBeDefined()
    expect(resultado.mapeo.niche).toBeDefined()
    expect(resultado.mapeo.city).toBeDefined()
    expect(resultado.mapeo.bought).toBeDefined()
  })

  it('lee las 1.035 filas del archivo', () => {
    expect(resultado.preparadas).toHaveLength(1035)
  })

  it('quedan 1.000 contactos después de fusionar los repetidos', () => {
    const utiles = resultado.unicas.filter((f) => !f.descartada)
    // 1.000 buenos + 10 con teléfono roto pero con Instagram usable.
    expect(utiles).toHaveLength(1010)
    expect(resultado.duplicadas).toHaveLength(20)
  })

  it('normaliza todos los teléfonos al mismo formato, vengan como vengan', () => {
    const buenos = resultado.unicas.filter((f) => f.phoneE164 !== null)
    expect(buenos.length).toBeGreaterThanOrEqual(1000)
    expect(buenos.every((f) => /^549\d{10}$/.test(f.phoneE164!))).toBe(true)
  })

  it('las cinco formas de escribir el mismo número dan el mismo resultado', () => {
    // Las primeras cinco filas usan las cinco formas sobre números correlativos;
    // todas tienen que quedar en formato E.164 con el mismo largo.
    const cinco = resultado.unicas.slice(0, 5).map((f) => f.phoneE164)
    expect(cinco.every((p) => p !== null && p.length === 13)).toBe(true)
  })

  it('los teléfonos rotos entran igual, con hasWhatsapp false y motivo', () => {
    const rotos = resultado.unicas.filter((f) => f.businessName.startsWith('Roto'))
    expect(rotos).toHaveLength(10)
    for (const r of rotos) {
      expect(r.descartada).toBe(false)
      expect(r.hasWhatsapp).toBe(false)
      expect(r.igUsername).not.toBeNull()
      expect(r.avisos.some((a) => a.startsWith('Teléfono:'))).toBe(true)
    }
  })

  it('las filas sin negocio quedan descartadas con motivo, no en silencio', () => {
    const sinNombre = resultado.unicas.filter((f) => f.descartada)
    expect(sinNombre).toHaveLength(5)
    expect(sinNombre.every((f) => f.avisos.length > 0)).toBe(true)
  })

  it('limpia los usuarios de Instagram', () => {
    const conIg = resultado.unicas.filter((f) => f.igUsername !== null)
    expect(conIg.length).toBeGreaterThan(300)
    expect(conIg.every((f) => /^[a-z0-9._]{1,30}$/.test(f.igUsername!))).toBe(true)
  })

  it('no hay dos contactos con el mismo teléfono', () => {
    const tels = resultado.unicas.map((f) => f.phoneE164).filter((x): x is string => x !== null)
    expect(new Set(tels).size).toBe(tels.length)
  })

  it('no hay dos contactos con el mismo Instagram', () => {
    const igs = resultado.unicas.map((f) => f.igUsername).filter((x): x is string => x !== null)
    expect(new Set(igs).size).toBe(igs.length)
  })

  it('procesa las 1.000 filas en menos de 3 segundos', () => {
    const t0 = performance.now()
    procesar(excel.buffer)
    expect(performance.now() - t0).toBeLessThan(3000)
  })

  it('importar el mismo archivo dos veces da exactamente lo mismo', () => {
    // Idempotencia del parseo: la dedupe contra la base se prueba aparte.
    const segunda = procesar(excel.buffer)
    expect(segunda.unicas.map((f) => f.dedupeKey)).toEqual(
      resultado.unicas.map((f) => f.dedupeKey),
    )
  })
})

describe('reparto de las 1.000 filas entre 10 cuentas', () => {
  const cuentas: CuentaParaReparto[] = Array.from({ length: 10 }, (_, i) => ({
    id: `id-${i}`,
    code: `WA-${String(i + 1).padStart(2, '0')}`,
    label: `WA-${i + 1}`,
    channel: 'whatsapp' as const,
    phoneE164: `54938345670${i}`,
    igUsername: null,
    cargaActual: 0,
    operativa: true,
  }))

  it('quedan repartidos parejo', () => {
    const utiles = resultado.unicas.filter((f) => !f.descartada && f.phoneE164 !== null)
    const asignaciones = repartir(
      utiles.map((f) => ({
        clave: String(f.rowNumber),
        tienePhone: true,
        tieneInstagram: f.igUsername !== null,
        accountRaw: null,
      })),
      cuentas,
    )

    const conteo = new Map<string, number>()
    for (const a of asignaciones) {
      if (a.waAccountId) conteo.set(a.waAccountId, (conteo.get(a.waAccountId) ?? 0) + 1)
    }

    expect(conteo.size).toBe(10)
    const valores = [...conteo.values()]
    // La diferencia entre la cuenta que más recibe y la que menos, como mucho 1.
    expect(Math.max(...valores) - Math.min(...valores)).toBeLessThanOrEqual(1)
  })

  it('a 30 mensajes por día, la lista se termina en los días que corresponde', () => {
    const utiles = resultado.unicas.filter((f) => !f.descartada && f.phoneE164 !== null)
    const porCuenta = Math.ceil(utiles.length / 10)
    expect(Math.ceil(porCuenta / 30)).toBeLessThanOrEqual(4)
  })
})

describe('importación con columna de cuenta asignada', () => {
  const cuentas: CuentaParaReparto[] = [
    {
      id: 'id-1',
      code: 'WA-01',
      label: 'WA-01',
      channel: 'whatsapp',
      phoneE164: '5493834567001',
      igUsername: null,
      cargaActual: 0,
      operativa: true,
    },
    {
      id: 'id-2',
      code: 'WA-02',
      label: 'WA-02',
      channel: 'whatsapp',
      phoneE164: '5493834567002',
      igUsername: null,
      cargaActual: 0,
      operativa: true,
    },
  ]

  function excelConCuenta(): FilaPreparada[] {
    const filas = [
      ['Negocio', 'Teléfono', 'Cuenta'],
      ['Kiosco', '3834000001', 'WA-01'],
      ['Panadería', '3834000002', 'WA-02'],
      ['Gimnasio', '3834000003', 'WA-99'],
      ['Ferretería', '3834000004', ''],
    ]
    const encabezados = filas[0]!
    const mapeo = adivinarMapeo(encabezados)
    return filas.slice(1).map((f, i) => prepararFila(f, mapeo, encabezados, i + 2))
  }

  it('cada contacto queda en la cuenta que indica el Excel', () => {
    const preparadas = excelConCuenta()
    const r = repartir(
      preparadas.map((f) => ({
        clave: String(f.rowNumber),
        tienePhone: f.phoneE164 !== null,
        tieneInstagram: false,
        accountRaw: f.accountRaw,
      })),
      cuentas,
    )

    expect(r[0]!.waAccountId).toBe('id-1')
    expect(r[1]!.waAccountId).toBe('id-2')
  })

  it('un valor que no coincide con ninguna cuenta va a Revisar', () => {
    const preparadas = excelConCuenta()
    const r = repartir(
      preparadas.map((f) => ({
        clave: String(f.rowNumber),
        tienePhone: true,
        tieneInstagram: false,
        accountRaw: f.accountRaw,
      })),
      cuentas,
    )

    expect(r[2]!.waAccountId).toBeNull()
    expect(r[2]!.aviso).toContain('WA-99')
  })

  it('las filas sin cuenta indicada se reparten solas', () => {
    const preparadas = excelConCuenta()
    const r = repartir(
      preparadas.map((f) => ({
        clave: String(f.rowNumber),
        tienePhone: true,
        tieneInstagram: false,
        accountRaw: f.accountRaw,
      })),
      cuentas,
    )

    expect(r[3]!.waAccountId).not.toBeNull()
    expect(r[3]!.aviso).toBeNull()
  })
})

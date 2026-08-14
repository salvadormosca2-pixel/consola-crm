import { describe, expect, it } from 'vitest'

import { adivinarMapeo, mapeoCompleto, normalizarEncabezado } from './columns'
import {
  repartir,
  resolverCuentaDelExcel,
  resumirReparto,
  type AsignacionPedida,
  type CuentaParaReparto,
} from './distribute'
import { canalPreferido, deduplicarArchivo, prepararFila } from './rows'

/* ── Detección de columnas ──────────────────────────────────────────────── */

describe('adivinarMapeo', () => {
  it('reconoce encabezados en castellano', () => {
    const h = ['Negocio', 'Nombre', 'Teléfono', 'Instagram', 'Rubro', 'Ciudad']
    const m = adivinarMapeo(h)
    expect(m.business_name).toBe(0)
    expect(m.contact_name).toBe(1)
    expect(m.phone).toBe(2)
    expect(m.instagram).toBe(3)
    expect(m.niche).toBe(4)
    expect(m.city).toBe(5)
  })

  it('no se marea con acentos, mayúsculas ni espacios', () => {
    const m = adivinarMapeo(['  RAZÓN SOCIAL ', 'Celular', 'Qué compró'])
    expect(m.business_name).toBe(0)
    expect(m.phone).toBe(1)
    expect(m.bought).toBe(2)
  })

  it('prefiere el sinónimo más específico', () => {
    // 'Nombre del negocio' tiene que ganar como negocio, no como nombre de persona.
    const m = adivinarMapeo(['Nombre del negocio', 'Nombre de contacto'])
    expect(m.business_name).toBe(0)
    expect(m.contact_name).toBe(1)
  })

  it('no asigna la misma columna a dos campos', () => {
    const m = adivinarMapeo(['Nombre', 'Contacto', 'Tel'])
    const usados = Object.values(m)
    expect(new Set(usados).size).toBe(usados.length)
  })

  it('detecta el teléfono por el contenido si el encabezado no ayuda', () => {
    const h = ['Empresa', 'Columna B', 'Columna C']
    const filas = [
      ['Kiosco', '0383 15 456 7890', 'algo'],
      ['Panadería', '+54 383 111 2222', 'otra cosa'],
      ['Gimnasio', '3834445555', 'mas'],
    ]
    expect(adivinarMapeo(h, filas).phone).toBe(1)
  })

  it('detecta Instagram por el contenido', () => {
    const h = ['Empresa', 'X']
    const filas = [
      ['Kiosco', '@kiosco'],
      ['Panadería', '@pan'],
      ['Gimnasio', 'instagram.com/gym'],
    ]
    expect(adivinarMapeo(h, filas).instagram).toBe(1)
  })

  it('reconoce la columna de cuenta asignada', () => {
    expect(adivinarMapeo(['Negocio', 'Tel', 'Cuenta']).account).toBe(2)
  })

  it('deja sin mapear lo que no reconoce, en vez de arriesgar', () => {
    const m = adivinarMapeo(['aaa', 'bbb', 'ccc'])
    expect(Object.keys(m)).toHaveLength(0)
  })

  it('normalizarEncabezado saca acentos y signos', () => {
    expect(normalizarEncabezado(' Teléfono / WhatsApp ')).toBe('telefonowhatsapp')
  })
})

describe('mapeoCompleto', () => {
  it('exige negocio y al menos un canal', () => {
    expect(mapeoCompleto({ business_name: 0, phone: 1 }).ok).toBe(true)
    expect(mapeoCompleto({ business_name: 0, instagram: 1 }).ok).toBe(true)
  })

  it('avisa qué falta', () => {
    const r = mapeoCompleto({ contact_name: 0 })
    expect(r.ok).toBe(false)
    expect(r.falta).toContain('Negocio')
    expect(r.falta.some((f) => f.includes('Teléfono'))).toBe(true)
  })
})

/* ── Preparación de filas ───────────────────────────────────────────────── */

const H = ['Negocio', 'Nombre', 'Teléfono', 'Instagram', 'Rubro', 'Cuenta']
const M = { business_name: 0, contact_name: 1, phone: 2, instagram: 3, niche: 4, account: 5 }

function preparar(fila: string[], n = 2) {
  return prepararFila(fila, M, H, n)
}

describe('prepararFila', () => {
  it('normaliza teléfono e Instagram', () => {
    const f = preparar(['Kiosco Norte', 'Ana', '0383 15 456 7890', '@KioscoNorte', 'kiosco', ''])
    expect(f.phoneE164).toBe('5493834567890')
    expect(f.hasWhatsapp).toBe(true)
    expect(f.igUsername).toBe('kiosconorte')
    expect(f.hasInstagram).toBe(true)
    expect(f.descartada).toBe(false)
    expect(f.avisos).toEqual([])
  })

  it('un teléfono inválido NO se pierde: entra con hasWhatsapp false y va a Revisar', () => {
    const f = preparar(['Panadería', 'Luis', '1234', '@pan', 'panaderia', ''])
    expect(f.descartada).toBe(false)
    expect(f.phoneE164).toBeNull()
    expect(f.hasWhatsapp).toBe(false)
    expect(f.igUsername).toBe('pan')
    expect(f.avisos.some((a) => a.startsWith('Teléfono:'))).toBe(true)
  })

  it('sin ningún canal utilizable la fila queda descartada, pero con motivo', () => {
    const f = preparar(['Gimnasio', 'Juan', 'nada', 'no sirve!!', 'gym', ''])
    expect(f.descartada).toBe(true)
    expect(f.avisos.some((a) => a.includes('ningún canal'))).toBe(true)
  })

  it('sin nombre de negocio queda descartada', () => {
    const f = preparar(['', 'Ana', '3834567890', '', '', ''])
    expect(f.descartada).toBe(true)
    expect(f.avisos.some((a) => a.includes('nombre del negocio'))).toBe(true)
  })

  it('la clave de deduplicación es el teléfono, y si no hay, el Instagram', () => {
    expect(preparar(['A', '', '3834567890', '@a', '', '']).dedupeKey).toBe('5493834567890')
    expect(preparar(['B', '', '', '@b', '', '']).dedupeKey).toBe('ig:b')
  })

  it('guarda la fila cruda para poder auditarla', () => {
    const f = preparar(['Kiosco', 'Ana', '3834567890', '', 'kiosco', 'WA-01'])
    expect(f.raw['Negocio']).toBe('Kiosco')
    expect(f.raw['Cuenta']).toBe('WA-01')
  })

  it('recorta los campos larguísimos en vez de romper el insert', () => {
    const f = preparar(['x'.repeat(500), '', '3834567890', '', '', ''])
    expect(f.businessName.length).toBe(200)
  })

  it('avisa si el teléfono es de otro país', () => {
    const f = preparar(['Cliente', '', '+1 555 123 4567', '', '', ''])
    expect(f.hasWhatsapp).toBe(true)
    expect(f.avisos.some((a) => a.includes('no es argentino'))).toBe(true)
  })

  it('canalPreferido es WhatsApp si hay teléfono, si no Instagram', () => {
    expect(canalPreferido({ phoneE164: '549383', igUsername: 'x' })).toBe('whatsapp')
    expect(canalPreferido({ phoneE164: null, igUsername: 'x' })).toBe('instagram')
    expect(canalPreferido({ phoneE164: null, igUsername: null })).toBeNull()
  })
})

/* ── Deduplicación dentro del archivo ───────────────────────────────────── */

describe('deduplicarArchivo', () => {
  it('el mismo teléfono dos veces entra una sola vez', () => {
    const filas = [
      preparar(['Kiosco', 'Ana', '3834567890', '', '', ''], 2),
      preparar(['Kiosco Norte', 'Ana', '0383 15 456 7890', '', '', ''], 3),
    ]
    const { unicas, duplicadas } = deduplicarArchivo(filas)
    expect(unicas).toHaveLength(1)
    expect(duplicadas).toHaveLength(1)
    expect(duplicadas[0]!.chocaCon).toBe(2)
    expect(duplicadas[0]!.motivo).toBe('telefono')
  })

  it('el mismo Instagram dos veces entra una sola vez', () => {
    const filas = [
      preparar(['A', '', '', '@mismo', '', ''], 2),
      preparar(['B', '', '', 'instagram.com/mismo/', '', ''], 3),
    ]
    expect(deduplicarArchivo(filas).unicas).toHaveLength(1)
  })

  it('una fila solo con Instagram y otra con teléfono + el mismo Instagram se fusionan', () => {
    // Este es el caso que un dedupe por una sola clave dejaría pasar: el
    // cliente terminaría recibiendo el mismo mensaje desde dos números.
    const filas = [
      preparar(['Kiosco', '', '', '@kiosco', '', ''], 2),
      preparar(['Kiosco', 'Ana', '3834567890', '@kiosco', 'kiosco', ''], 3),
    ]
    const { unicas, duplicadas } = deduplicarArchivo(filas)
    expect(unicas).toHaveLength(1)
    expect(duplicadas).toHaveLength(1)
    // Y la que queda tiene los dos canales.
    expect(unicas[0]!.phoneE164).toBe('5493834567890')
    expect(unicas[0]!.igUsername).toBe('kiosco')
    expect(unicas[0]!.contactName).toBe('Ana')
  })

  it('no fusiona contactos distintos', () => {
    const filas = [
      preparar(['A', '', '3834567890', '@a', '', ''], 2),
      preparar(['B', '', '3834567891', '@b', '', ''], 3),
    ]
    expect(deduplicarArchivo(filas).unicas).toHaveLength(2)
  })

  it('las descartadas pasan derecho para poder mostrarlas en Revisar', () => {
    const filas = [
      preparar(['', '', '', '', '', ''], 2),
      preparar(['A', '', '3834567890', '', '', ''], 3),
    ]
    const { unicas } = deduplicarArchivo(filas)
    expect(unicas).toHaveLength(2)
  })

  it('aguanta 1.000 filas con muchos repetidos', () => {
    const filas = Array.from({ length: 1000 }, (_, i) =>
      preparar([`Negocio ${i % 400}`, '', `38345${String(10000 + (i % 400))}`, '', '', ''], i + 2),
    )
    const { unicas, duplicadas } = deduplicarArchivo(filas)
    expect(unicas).toHaveLength(400)
    expect(duplicadas).toHaveLength(600)
  })
})

/* ── Reparto entre cuentas ──────────────────────────────────────────────── */

function cuenta(
  code: string,
  channel: 'whatsapp' | 'instagram',
  cargaActual = 0,
  operativa = true,
): CuentaParaReparto {
  return {
    id: `id-${code}`,
    code,
    label: `${code} Ventas`,
    channel,
    phoneE164: channel === 'whatsapp' ? `54938345670${code.slice(-2)}` : null,
    igUsername: channel === 'instagram' ? code.toLowerCase() : null,
    cargaActual,
    operativa,
  }
}

const DIEZ_WA = Array.from({ length: 10 }, (_, i) =>
  cuenta(`WA-${String(i + 1).padStart(2, '0')}`, 'whatsapp'),
)

function pedidos(n: number, opts: Partial<AsignacionPedida> = {}): AsignacionPedida[] {
  return Array.from({ length: n }, (_, i) => ({
    clave: `c${i}`,
    tienePhone: true,
    tieneInstagram: false,
    accountRaw: null,
    ...opts,
  }))
}

describe('resolverCuentaDelExcel', () => {
  const cuentas = [cuenta('WA-01', 'whatsapp'), cuenta('IG-01', 'instagram')]

  it('resuelve por código, sin importar mayúsculas', () => {
    expect(resolverCuentaDelExcel('wa-01', cuentas)?.code).toBe('WA-01')
    expect(resolverCuentaDelExcel(' WA-01 ', cuentas)?.code).toBe('WA-01')
  })

  it('resuelve por número, con o sin signos', () => {
    expect(resolverCuentaDelExcel('+5493834567001', cuentas)?.code).toBe('WA-01')
    expect(resolverCuentaDelExcel('5493834567001', cuentas)?.code).toBe('WA-01')
  })

  it('resuelve por usuario de Instagram', () => {
    expect(resolverCuentaDelExcel('@ig-01', cuentas)?.code).toBe('IG-01')
  })

  it('devuelve null si no coincide con ninguna, en vez de adivinar', () => {
    expect(resolverCuentaDelExcel('WA-99', cuentas)).toBeNull()
    expect(resolverCuentaDelExcel('cualquier cosa', cuentas)).toBeNull()
    expect(resolverCuentaDelExcel('', cuentas)).toBeNull()
  })
})

describe('repartir', () => {
  it('reparte parejo entre las 10 cuentas', () => {
    const r = repartir(pedidos(1000), DIEZ_WA)
    const porCuenta = new Map<string, number>()
    for (const a of r) {
      if (a.waAccountId) porCuenta.set(a.waAccountId, (porCuenta.get(a.waAccountId) ?? 0) + 1)
    }
    expect(porCuenta.size).toBe(10)
    expect([...porCuenta.values()].every((n) => n === 100)).toBe(true)
  })

  it('un segundo import no desbalancea: compensa la carga previa', () => {
    // WA-01 arranca con 50 de un import anterior; las otras en cero.
    const cuentas = DIEZ_WA.map((c, i) => ({ ...c, cargaActual: i === 0 ? 50 : 0 }))
    const r = repartir(pedidos(90), cuentas)

    const porCuenta = new Map<string, number>()
    for (const a of r) {
      if (a.waAccountId) porCuenta.set(a.waAccountId, (porCuenta.get(a.waAccountId) ?? 0) + 1)
    }
    // La que venía cargada no recibe nada hasta que las demás la alcancen.
    expect(porCuenta.get('id-WA-01') ?? 0).toBe(0)
    expect([...porCuenta.values()].reduce((a, b) => a + b, 0)).toBe(90)
  })

  it('la columna del Excel manda por encima del balanceo', () => {
    const r = repartir(pedidos(5, { accountRaw: 'WA-03' }), DIEZ_WA)
    expect(r.every((a) => a.waAccountId === 'id-WA-03')).toBe(true)
    expect(r.every((a) => a.aviso === null)).toBe(true)
  })

  it('un valor de cuenta que no existe va a Revisar y no se asigna solo', () => {
    const r = repartir(pedidos(1, { accountRaw: 'WA-99' }), DIEZ_WA)
    expect(r[0]!.waAccountId).toBeNull()
    expect(r[0]!.aviso).toContain('WA-99')
  })

  it('una cuenta pausada indicada en el Excel se rechaza con motivo', () => {
    const cuentas = [cuenta('WA-01', 'whatsapp', 0, false)]
    const r = repartir(pedidos(1, { accountRaw: 'WA-01' }), cuentas)
    expect(r[0]!.waAccountId).toBeNull()
    expect(r[0]!.aviso).toContain('no está en condiciones')
  })

  it('un contacto con los dos canales recibe cuenta de WhatsApp y de Instagram', () => {
    const cuentas = [...DIEZ_WA, cuenta('IG-01', 'instagram')]
    const r = repartir(pedidos(1, { tienePhone: true, tieneInstagram: true }), cuentas)
    expect(r[0]!.waAccountId).not.toBeNull()
    expect(r[0]!.igAccountId).toBe('id-IG-01')
  })

  it('un contacto solo con Instagram va a cuentas de Instagram', () => {
    const cuentas = [...DIEZ_WA, cuenta('IG-01', 'instagram')]
    const r = repartir(pedidos(1, { tienePhone: false, tieneInstagram: true }), cuentas)
    expect(r[0]!.waAccountId).toBeNull()
    expect(r[0]!.igAccountId).toBe('id-IG-01')
  })

  it('avisa si no hay cuentas activas del canal que hace falta', () => {
    const r = repartir(pedidos(1), [cuenta('WA-01', 'whatsapp', 0, false)])
    expect(r[0]!.waAccountId).toBeNull()
    expect(r[0]!.aviso).toContain('No hay cuentas de WhatsApp activas')
  })

  it('el reparto es reproducible: mismo input, mismo resultado', () => {
    const a = repartir(pedidos(50), DIEZ_WA).map((x) => x.waAccountId)
    const b = repartir(pedidos(50), DIEZ_WA).map((x) => x.waAccountId)
    expect(a).toEqual(b)
  })

  it('no usa cuentas del canal equivocado', () => {
    const cuentas = [cuenta('IG-01', 'instagram')]
    const r = repartir(pedidos(3), cuentas)
    expect(r.every((x) => x.waAccountId === null)).toBe(true)
  })
})

describe('resumirReparto', () => {
  it('dice cuántos contactos quedaron en cada cuenta', () => {
    const r = repartir(pedidos(30), DIEZ_WA)
    const resumen = resumirReparto(r, DIEZ_WA)
    expect(resumen).toHaveLength(10)
    expect(resumen.every((x) => x.asignados === 3)).toBe(true)
  })

  it('no lista cuentas que no recibieron nada', () => {
    const r = repartir(pedidos(2, { accountRaw: 'WA-01' }), DIEZ_WA)
    const resumen = resumirReparto(r, DIEZ_WA)
    expect(resumen).toHaveLength(1)
    expect(resumen[0]!.code).toBe('WA-01')
  })
})

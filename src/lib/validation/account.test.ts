import { describe, expect, it } from 'vitest'

import { CHECKLIST_PREPARACION } from '@/server/rotation/quota'

import { accountSchema, normalizarE164, normalizarIgUsername } from './account'

/** Checklist completo: sin esto, una cuenta no puede quedar activa. */
const CHECKLIST_OK = CHECKLIST_PREPARACION.map((i) => i.key).join(',')

const BASE = {
  code: 'wa-01',
  label: 'WA-01 Ventas',
  channel: 'whatsapp' as const,
  phone: '5493834567890',
  igUsername: '',
  instanceName: '',
  sessionHint: '',
  mode: 'manual' as const,
  status: 'activa' as const,
  dailyCap: '30',
  minGapSeconds: '240',
  windowStart: '09:00',
  windowEnd: '20:00',
  prepChecklist: CHECKLIST_OK,
  notes: '',
}

/** Devuelve el mensaje de error del campo pedido, o null si ese campo pasó. */
function errorDe(input: Record<string, unknown>, campo: string): string | null {
  const r = accountSchema.safeParse(input)
  if (r.success) return null
  return r.error.issues.find((i) => i.path[0] === campo)?.message ?? null
}

describe('normalizarIgUsername', () => {
  it('quita la arroba', () => {
    expect(normalizarIgUsername('@Usuario')).toBe('usuario')
  })

  it('quita la URL completa con y sin barra final', () => {
    expect(normalizarIgUsername('instagram.com/usuario/')).toBe('usuario')
    expect(normalizarIgUsername('https://www.instagram.com/Usuario')).toBe('usuario')
    expect(normalizarIgUsername('https://instagram.com/usuario/?hl=es')).toBe('usuario')
  })

  it('quita espacios sobrantes y pasa a minúsculas', () => {
    expect(normalizarIgUsername('  Usuario ')).toBe('usuario')
  })

  it('las tres formas del criterio de aceptación dan lo mismo', () => {
    const formas = ['@Usuario', 'instagram.com/usuario/', 'Usuario ']
    expect(new Set(formas.map(normalizarIgUsername))).toEqual(new Set(['usuario']))
  })

  it('conserva puntos y guiones bajos', () => {
    expect(normalizarIgUsername('@mi.negocio_ok')).toBe('mi.negocio_ok')
  })
})

describe('normalizarE164', () => {
  it('deja solo dígitos', () => {
    expect(normalizarE164('+54 9 383 456-7890')).toBe('5493834567890')
    expect(normalizarE164('(549) 383 4567890')).toBe('5493834567890')
  })
})

describe('accountSchema', () => {
  it('acepta una cuenta de WhatsApp válida y normaliza el código a mayúsculas', () => {
    const r = accountSchema.safeParse(BASE)
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.code).toBe('WA-01')
    expect(r.data.phoneE164).toBe('5493834567890')
    expect(r.data.igUsername).toBeNull()
    expect(r.data.sessionHint).toBeNull()
  })

  it('acepta una cuenta de Instagram y limpia la URL', () => {
    const r = accountSchema.safeParse({
      ...BASE,
      code: 'IG-01',
      channel: 'instagram',
      phone: '',
      igUsername: 'https://instagram.com/MiNegocio/',
    })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.igUsername).toBe('minegocio')
    expect(r.data.phoneE164).toBeNull()
  })

  it('rechaza un teléfono demasiado corto', () => {
    expect(errorDe({ ...BASE, phone: '123' }, 'phone')).toMatch(/internacional/)
  })

  it('rechaza una cuenta de WhatsApp que además trae usuario de Instagram', () => {
    expect(errorDe({ ...BASE, igUsername: 'algo' }, 'igUsername')).toMatch(/no lleva usuario/)
  })

  it('rechaza una cuenta de Instagram que además trae teléfono', () => {
    expect(
      errorDe({ ...BASE, channel: 'instagram', igUsername: 'algo', phone: '5493834567890' }, 'phone'),
    ).toMatch(/no lleva teléfono/)
  })

  it('rechaza un usuario de Instagram con caracteres inválidos', () => {
    expect(
      errorDe({ ...BASE, channel: 'instagram', phone: '', igUsername: 'mi negocio!' }, 'igUsername'),
    ).toMatch(/inválido/)
  })

  it('no deja poner una cuenta en uso con el checklist incompleto', () => {
    // Un número sin perfil armado ni conversaciones reales no entra al reparto:
    // mandar poco no es calentar.
    for (const status of ['activa', 'calentando'] as const) {
      expect(errorDe({ ...BASE, status, prepChecklist: '' }, 'prepChecklist')).toMatch(/checklist/)
    }
  })

  it('deja guardar una cuenta sin preparar mientras no entre al reparto', () => {
    const r = accountSchema.safeParse({
      ...BASE,
      status: 'esperando_preparacion',
      prepChecklist: '',
    })
    expect(r.success).toBe(true)
  })

  it('con el checklist completo la cuenta puede quedar calentando', () => {
    const r = accountSchema.safeParse({ ...BASE, status: 'calentando' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.prepChecklist).toEqual(
      Object.fromEntries(CHECKLIST_PREPARACION.map((i) => [i.key, true])),
    )
  })

  it('falta un solo punto del checklist y no deja activarla', () => {
    const casi = CHECKLIST_PREPARACION.slice(0, -1).map((i) => i.key).join(',')
    expect(errorDe({ ...BASE, prepChecklist: casi }, 'prepChecklist')).toMatch(/Falta/)
  })

  it('ignora claves de checklist inventadas', () => {
    expect(errorDe({ ...BASE, prepChecklist: 'perfil,inventada,otra' }, 'prepChecklist')).toMatch(
      /checklist/,
    )
  })

  it('guarda la sesión del navegador solo en Instagram', () => {
    const ig = accountSchema.safeParse({
      ...BASE,
      channel: 'instagram',
      phone: '',
      igUsername: 'minegocio',
      sessionHint: 'Chrome perfil 3',
    })
    expect(ig.success).toBe(true)
    if (ig.success) expect(ig.data.sessionHint).toBe('Chrome perfil 3')

    const wa = accountSchema.safeParse({ ...BASE, sessionHint: 'Chrome perfil 3' })
    expect(wa.success).toBe(true)
    if (wa.success) expect(wa.data.sessionHint).toBeNull()
  })

  it('rechaza una ventana horaria invertida', () => {
    expect(errorDe({ ...BASE, windowStart: '20:00', windowEnd: '09:00' }, 'windowEnd')).toMatch(
      /posterior/,
    )
  })

  it('rechaza una hora con formato inválido', () => {
    expect(errorDe({ ...BASE, windowStart: '9am' }, 'windowStart')).toMatch(/HH:mm/)
  })

  it('rechaza un cupo fuera de rango', () => {
    expect(errorDe({ ...BASE, dailyCap: '900' }, 'dailyCap')).toMatch(/máximo/)
    expect(errorDe({ ...BASE, dailyCap: '-1' }, 'dailyCap')).toMatch(/negativo/)
  })

  it('rechaza un código con caracteres raros', () => {
    expect(errorDe({ ...BASE, code: 'WA 01!' }, 'code')).toMatch(/letras, números/)
  })

  it('deja en null los campos de texto que llegan vacíos', () => {
    const r = accountSchema.safeParse(BASE)
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.instanceName).toBeNull()
    expect(r.data.notes).toBeNull()
  })
})

import { z } from 'zod'

import { ACCOUNT_MODES, ACCOUNT_STATUSES, CHANNELS } from '@/db/enums'
import { CHECKLIST_PREPARACION } from '@/server/rotation/quota'

/** Normaliza un usuario de Instagram: sin @, sin URL, minúsculas, sin espacios. */
export function normalizarIgUsername(valor: string): string {
  return valor
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(?:www\.)?instagram\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/**
 * Normalización mínima de E.164 para las cuentas emisoras: son mis propios
 * números y se cargan a mano, así que se piden en formato internacional.
 * La normalización de teléfonos argentinos de los contactos (que vienen sucios
 * del Excel) es otra cosa y va en la fase 2.
 */
export function normalizarE164(valor: string): string {
  return valor.replace(/\D/g, '')
}

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/

const base = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'El código necesita al menos 2 caracteres.')
    .max(16, 'El código no puede pasar de 16 caracteres.')
    .regex(/^[A-Za-z0-9._-]+$/, 'Usá solo letras, números, punto, guion y guion bajo.'),
  label: z.string().trim().min(2, 'Poné un nombre reconocible.').max(80),
  channel: z.enum(CHANNELS),
  phone: z.string().trim().optional().default(''),
  igUsername: z.string().trim().optional().default(''),
  instanceName: z.string().trim().max(80).optional().default(''),
  mode: z.enum(ACCOUNT_MODES),
  status: z.enum(ACCOUNT_STATUSES),
  dailyCap: z.coerce.number().int().min(0, 'El cupo no puede ser negativo.').max(500, 'Cupo máximo: 500.'),
  minGapSeconds: z.coerce.number().int().min(0).max(3600),
  /** En qué sesión hay que estar para usarla. Solo tiene sentido en Instagram. */
  sessionHint: z.string().trim().max(80).optional().default(''),
  /** Los ítems tildados del checklist de preparación, como lista de claves. */
  prepChecklist: z.string().optional().default(''),
  windowStart: z.string().regex(HORA, 'Usá el formato HH:mm, por ejemplo 09:00.'),
  windowEnd: z.string().regex(HORA, 'Usá el formato HH:mm, por ejemplo 20:00.'),
  notes: z.string().trim().max(500).optional().default(''),
})

export const accountSchema = base
  .superRefine((v, ctx) => {
    if (v.channel === 'whatsapp') {
      const digits = normalizarE164(v.phone)
      if (digits.length < 8 || digits.length > 15) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['phone'],
          message: 'Poné el número en formato internacional, por ejemplo 5493834567890.',
        })
      }
      if (v.igUsername.trim().length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['igUsername'],
          message: 'Una cuenta de WhatsApp no lleva usuario de Instagram.',
        })
      }
    } else {
      const usuario = normalizarIgUsername(v.igUsername)
      if (!/^[a-z0-9._]{1,30}$/.test(usuario)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['igUsername'],
          message: 'Usuario de Instagram inválido. Solo letras, números, punto y guion bajo.',
        })
      }
      if (v.phone.trim().length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['phone'],
          message: 'Una cuenta de Instagram no lleva teléfono.',
        })
      }
    }

    // Un número no puede entrar al reparto sin el checklist completo. Mandar
    // poco no es calentar: lo que sostiene un número es el perfil y el tráfico
    // real, y eso el software no lo puede verificar solo.
    if (v.status === 'activa' || v.status === 'calentando') {
      const marcados = new Set(leerChecklist(v.prepChecklist))
      const faltan = CHECKLIST_PREPARACION.filter((i) => !marcados.has(i.key))
      if (faltan.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['prepChecklist'],
          message: `Faltan ${faltan.length} puntos del checklist para poner la cuenta en uso.`,
        })
      }
    }

    if (v.windowStart >= v.windowEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['windowEnd'],
        message: 'La hora de cierre tiene que ser posterior a la de apertura.',
      })
    }
  })
  .transform((v) => ({
    code: v.code.toUpperCase(),
    label: v.label,
    channel: v.channel,
    phoneE164: v.channel === 'whatsapp' ? normalizarE164(v.phone) : null,
    igUsername: v.channel === 'instagram' ? normalizarIgUsername(v.igUsername) : null,
    instanceName: v.instanceName.length > 0 ? v.instanceName : null,
    mode: v.mode,
    status: v.status,
    dailyCap: v.dailyCap,
    minGapSeconds: v.minGapSeconds,
    windowStart: v.windowStart,
    windowEnd: v.windowEnd,
    sessionHint: v.channel === 'instagram' && v.sessionHint.length > 0 ? v.sessionHint : null,
    prepChecklist: Object.fromEntries(leerChecklist(v.prepChecklist).map((k) => [k, true])),
    notes: v.notes.length > 0 ? v.notes : null,
  }))

/** El checklist viaja como lista de claves separadas por coma desde el formulario. */
function leerChecklist(valor: string): string[] {
  const validas = new Set<string>(CHECKLIST_PREPARACION.map((i) => i.key))
  return valor
    .split(',')
    .map((s) => s.trim())
    .filter((s) => validas.has(s))
}

export type AccountInput = z.input<typeof accountSchema>
export type AccountValues = z.output<typeof accountSchema>

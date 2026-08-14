import type { Channel } from '@/db/enums'

/**
 * Reparto de contactos entre cuentas emisoras.
 *
 * La asignación se decide UNA vez y no se mueve: el cliente vio ese número,
 * tiene que seguir viendo ese número. Reasignar solo pasa a mano o cuando una
 * cuenta queda bloqueada.
 *
 * Hay dos formas de decidirla y las dos tienen que funcionar:
 *   1. Desde el Excel, si la columna de cuenta viene cargada (prioritaria).
 *   2. Reparto automático balanceado por carga real.
 */

export interface CuentaParaReparto {
  id: string
  code: string
  label: string
  channel: Channel
  phoneE164: string | null
  igUsername: string | null
  /** Cuántos contactos tiene ya asignados y sin contactar. */
  cargaActual: number
  operativa: boolean
}

/**
 * Resuelve el valor de la columna de cuenta contra las cuentas cargadas.
 *
 * Acepta el código (`WA-01`), el número (`+5493834567890`, con o sin signos),
 * el usuario de Instagram (`@minegocio`) o la etiqueta completa. Si no
 * coincide con ninguna, devuelve null y la fila va a Revisar: no se adivina.
 */
export function resolverCuentaDelExcel(
  valor: string,
  cuentas: CuentaParaReparto[],
): CuentaParaReparto | null {
  const v = valor.trim()
  if (v.length === 0) return null

  const porCodigo = v.toUpperCase()
  const soloDigitos = v.replace(/\D/g, '')
  const comoIg = v.replace(/^@/, '').toLowerCase()
  const comoTexto = v.toLowerCase()

  return (
    cuentas.find((c) => c.code.toUpperCase() === porCodigo) ??
    (soloDigitos.length >= 8
      ? cuentas.find((c) => c.phoneE164 !== null && c.phoneE164 === soloDigitos)
      : undefined) ??
    cuentas.find((c) => c.igUsername !== null && c.igUsername === comoIg) ??
    cuentas.find((c) => c.label.toLowerCase() === comoTexto) ??
    null
  )
}

export interface AsignacionPedida {
  /** Identifica la fila dentro del lote. */
  clave: string
  tienePhone: boolean
  tieneInstagram: boolean
  /** Lo que decía la columna de cuenta, si venía. */
  accountRaw: string | null
}

export interface AsignacionResuelta {
  clave: string
  waAccountId: string | null
  igAccountId: string | null
  /** Motivo por el que la fila necesita revisión, si lo hay. */
  aviso: string | null
}

/**
 * Reparte un lote de contactos entre las cuentas activas.
 *
 * El balanceo mira la carga que cada cuenta YA tiene asignada y pendiente, no
 * el orden de las filas. Por eso importar un segundo Excel no desbalancea el
 * sistema: las cuentas que quedaron cargadas en el primer import reciben menos
 * en el segundo.
 *
 * Un contacto con los dos canales recibe cuenta de WhatsApp Y de Instagram,
 * para poder usar el otro canal si el primero no responde.
 */
export function repartir(
  pedidos: AsignacionPedida[],
  cuentas: CuentaParaReparto[],
): AsignacionResuelta[] {
  // Copia mutable de la carga, para ir balanceando dentro del lote.
  const carga = new Map<string, number>()
  for (const c of cuentas) carga.set(c.id, c.cargaActual)

  const activasWa = cuentas.filter((c) => c.channel === 'whatsapp' && c.operativa)
  const activasIg = cuentas.filter((c) => c.channel === 'instagram' && c.operativa)

  /** Toma la cuenta menos cargada del canal, y le suma uno. */
  const menosCargada = (candidatas: CuentaParaReparto[]): string | null => {
    if (candidatas.length === 0) return null
    let elegida = candidatas[0]!
    let menor = carga.get(elegida.id) ?? 0
    for (const c of candidatas) {
      const n = carga.get(c.id) ?? 0
      // A igualdad gana la de código más bajo, para que el reparto sea estable
      // y reproducible en vez de depender del orden de la consulta.
      if (n < menor || (n === menor && c.code < elegida.code)) {
        elegida = c
        menor = n
      }
    }
    carga.set(elegida.id, menor + 1)
    return elegida.id
  }

  return pedidos.map((p) => {
    // ── 1. Lo que dice el Excel manda ───────────────────────────────────
    if (p.accountRaw !== null && p.accountRaw.trim().length > 0) {
      const cuenta = resolverCuentaDelExcel(p.accountRaw, cuentas)
      if (cuenta === null) {
        return {
          clave: p.clave,
          waAccountId: null,
          igAccountId: null,
          aviso: `La cuenta «${p.accountRaw}» no coincide con ninguna cargada.`,
        }
      }
      if (!cuenta.operativa) {
        return {
          clave: p.clave,
          waAccountId: null,
          igAccountId: null,
          aviso: `La cuenta ${cuenta.code} no está en condiciones de enviar.`,
        }
      }

      carga.set(cuenta.id, (carga.get(cuenta.id) ?? 0) + 1)

      // Si el Excel indica una cuenta de WhatsApp y el contacto además tiene
      // Instagram, el canal secundario se reparte igual.
      if (cuenta.channel === 'whatsapp') {
        return {
          clave: p.clave,
          waAccountId: cuenta.id,
          igAccountId: p.tieneInstagram ? menosCargada(activasIg) : null,
          aviso: p.tienePhone ? null : `Se asignó ${cuenta.code} pero el contacto no tiene teléfono válido.`,
        }
      }
      return {
        clave: p.clave,
        waAccountId: p.tienePhone ? menosCargada(activasWa) : null,
        igAccountId: cuenta.id,
        aviso: p.tieneInstagram ? null : `Se asignó ${cuenta.code} pero el contacto no tiene Instagram.`,
      }
    }

    // ── 2. Reparto automático balanceado ────────────────────────────────
    const wa = p.tienePhone ? menosCargada(activasWa) : null
    const ig = p.tieneInstagram ? menosCargada(activasIg) : null

    let aviso: string | null = null
    if (p.tienePhone && wa === null) aviso = 'No hay cuentas de WhatsApp activas para asignarle.'
    else if (p.tieneInstagram && ig === null && !p.tienePhone) {
      aviso = 'No hay cuentas de Instagram activas para asignarle.'
    }

    return { clave: p.clave, waAccountId: wa, igAccountId: ig, aviso }
  })
}

/** Resumen "cuántos quedaron en cada cuenta", para el final de la importación. */
export function resumirReparto(
  asignaciones: AsignacionResuelta[],
  cuentas: CuentaParaReparto[],
): Array<{ code: string; label: string; channel: Channel; asignados: number }> {
  const cuenta = new Map<string, number>()
  for (const a of asignaciones) {
    if (a.waAccountId) cuenta.set(a.waAccountId, (cuenta.get(a.waAccountId) ?? 0) + 1)
    if (a.igAccountId) cuenta.set(a.igAccountId, (cuenta.get(a.igAccountId) ?? 0) + 1)
  }
  return cuentas
    .map((c) => ({
      code: c.code,
      label: c.label,
      channel: c.channel,
      asignados: cuenta.get(c.id) ?? 0,
    }))
    .filter((c) => c.asignados > 0)
    .sort((a, b) => b.asignados - a.asignados)
}

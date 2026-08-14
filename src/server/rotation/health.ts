import type { AccountStatus, Salud } from '@/db/enums'

/**
 * Semáforo de salud por número.
 *
 * Va con el motivo siempre: un color sin explicación no sirve para decidir si
 * pausar un número o seguir. Es lógica pura para poder testearla sin base.
 */

export interface SenalesDeSalud {
  status: AccountStatus
  /** Fallos seguidos sin un envío exitoso en el medio. */
  consecutiveFailures: number
  /** Mensajes enviados por este número en los últimos 7 días. */
  enviados7d: number
  /** De esos, cuántos recibieron respuesta. */
  respondidos7d: number
  /** Tasa de respuesta histórica del número, para comparar contra la reciente. */
  tasaHistorica: number | null
  /** Días desde el primer envío del número. */
  diasDeUso: number
  /** La instancia de Evolution está desconectada. */
  instanciaCaida?: boolean
}

export interface Diagnostico {
  salud: Salud
  motivo: string
}

/** Envíos mínimos para que una tasa de respuesta signifique algo. */
const MUESTRA_MINIMA = 10

export function diagnosticar(s: SenalesDeSalud, umbralBajo = 0.1): Diagnostico {
  if (s.status === 'bloqueada') {
    return { salud: 'rojo', motivo: 'La cuenta está bloqueada y fuera del reparto.' }
  }
  if (s.instanciaCaida) {
    return { salud: 'rojo', motivo: 'La instancia de Evolution está desconectada.' }
  }
  if (s.consecutiveFailures >= 3) {
    return { salud: 'rojo', motivo: `${s.consecutiveFailures} fallos de entrega seguidos.` }
  }
  if (s.status === 'esperando_preparacion') {
    return { salud: 'amarillo', motivo: 'Falta completar el checklist de preparación.' }
  }
  if (s.status === 'pausada') {
    return { salud: 'amarillo', motivo: 'La cuenta está pausada, no entra al reparto.' }
  }
  if (s.consecutiveFailures > 0) {
    return {
      salud: 'amarillo',
      motivo: `${s.consecutiveFailures} fallo${s.consecutiveFailures === 1 ? '' : 's'} de entrega sin recuperar.`,
    }
  }

  // Sin muestra suficiente no se puede diagnosticar por tasa de respuesta.
  if (s.enviados7d < MUESTRA_MINIMA) {
    if (s.diasDeUso <= 7 && s.status === 'calentando') {
      return { salud: 'verde', motivo: 'En calentamiento, todavía sin muestra para evaluar.' }
    }
    return { salud: 'verde', motivo: 'Sin envíos suficientes esta semana para evaluar.' }
  }

  const tasa = s.respondidos7d / s.enviados7d
  const pct = Math.round(tasa * 100)

  if (tasa < umbralBajo) {
    return {
      salud: 'rojo',
      motivo: `Solo ${pct}% de respuestas en los últimos 7 días (${s.respondidos7d} de ${s.enviados7d}).`,
    }
  }

  // Caída brusca contra la propia historia del número: la primera señal de
  // restricción es que la gente deja de contestar, antes de cualquier error.
  if (s.tasaHistorica !== null && s.tasaHistorica > 0 && tasa < s.tasaHistorica * 0.5) {
    return {
      salud: 'amarillo',
      motivo: `La respuesta cayó de ${Math.round(s.tasaHistorica * 100)}% a ${pct}% esta semana.`,
    }
  }

  return { salud: 'verde', motivo: `${pct}% de respuestas en los últimos 7 días.` }
}

/**
 * ¿Corresponde bloquear la cuenta sola?
 *
 * Tres fallos seguidos o la instancia caída. La caída de tasa de respuesta NO
 * bloquea automáticamente: avisa. Bloquear un número por una mala semana sería
 * peor que el problema.
 */
export function debeBloquearse(
  s: Pick<SenalesDeSalud, 'consecutiveFailures' | 'instanciaCaida'>,
  fallosParaBloquear: number,
): { bloquear: boolean; motivo: string } {
  if (s.instanciaCaida) {
    return { bloquear: true, motivo: 'La instancia de Evolution se desconectó.' }
  }
  if (s.consecutiveFailures >= fallosParaBloquear) {
    return { bloquear: true, motivo: `${s.consecutiveFailures} fallos de entrega seguidos.` }
  }
  return { bloquear: false, motivo: '' }
}

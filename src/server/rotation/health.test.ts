import { describe, expect, it } from 'vitest'

import { debeBloquearse, diagnosticar, type SenalesDeSalud } from './health'

const SANA: SenalesDeSalud = {
  status: 'activa',
  consecutiveFailures: 0,
  enviados7d: 100,
  respondidos7d: 25,
  tasaHistorica: 0.25,
  diasDeUso: 60,
}

describe('diagnosticar', () => {
  it('un número sano da verde con el porcentaje', () => {
    const d = diagnosticar(SANA)
    expect(d.salud).toBe('verde')
    expect(d.motivo).toContain('25%')
  })

  it('una cuenta bloqueada siempre es roja', () => {
    expect(diagnosticar({ ...SANA, status: 'bloqueada' }).salud).toBe('rojo')
  })

  it('la instancia caída es roja aunque la tasa sea buena', () => {
    const d = diagnosticar({ ...SANA, instanciaCaida: true })
    expect(d.salud).toBe('rojo')
    expect(d.motivo).toContain('desconectada')
  })

  it('tres fallos seguidos son rojos', () => {
    expect(diagnosticar({ ...SANA, consecutiveFailures: 3 }).salud).toBe('rojo')
  })

  it('un fallo suelto es amarillo, no rojo', () => {
    const d = diagnosticar({ ...SANA, consecutiveFailures: 1 })
    expect(d.salud).toBe('amarillo')
    expect(d.motivo).toContain('1 fallo ')
  })

  it('una tasa por debajo del 10% es roja', () => {
    const d = diagnosticar({ ...SANA, enviados7d: 100, respondidos7d: 4 })
    expect(d.salud).toBe('rojo')
    expect(d.motivo).toContain('4 de 100')
  })

  it('una caída a la mitad de su propia historia avisa en amarillo', () => {
    // La primera señal de restricción es que la gente deja de contestar, antes
    // de que aparezca cualquier error de entrega.
    const d = diagnosticar({ ...SANA, respondidos7d: 11, tasaHistorica: 0.3 })
    expect(d.salud).toBe('amarillo')
    expect(d.motivo).toContain('cayó')
  })

  it('no diagnostica por tasa sin muestra suficiente', () => {
    // 1 de 3 sin respuesta no significa nada: haría falsos rojos todo el tiempo.
    const d = diagnosticar({ ...SANA, enviados7d: 3, respondidos7d: 0 })
    expect(d.salud).toBe('verde')
    expect(d.motivo).toContain('Sin envíos suficientes')
  })

  it('una cuenta sin preparar es amarilla y dice qué falta', () => {
    const d = diagnosticar({ ...SANA, status: 'esperando_preparacion' })
    expect(d.salud).toBe('amarillo')
    expect(d.motivo).toContain('checklist')
  })

  it('una cuenta pausada es amarilla', () => {
    expect(diagnosticar({ ...SANA, status: 'pausada' }).salud).toBe('amarillo')
  })

  it('un número que recién empieza a calentar no da alarma', () => {
    const d = diagnosticar({
      ...SANA,
      status: 'calentando',
      enviados7d: 5,
      respondidos7d: 0,
      diasDeUso: 2,
      tasaHistorica: null,
    })
    expect(d.salud).toBe('verde')
  })

  it('siempre devuelve un motivo, nunca un color pelado', () => {
    const casos: SenalesDeSalud[] = [
      SANA,
      { ...SANA, status: 'bloqueada' },
      { ...SANA, consecutiveFailures: 5 },
      { ...SANA, respondidos7d: 1 },
      { ...SANA, enviados7d: 0, respondidos7d: 0 },
    ]
    for (const c of casos) {
      expect(diagnosticar(c).motivo.length).toBeGreaterThan(10)
    }
  })
})

describe('debeBloquearse', () => {
  it('bloquea a los 3 fallos seguidos', () => {
    expect(debeBloquearse({ consecutiveFailures: 3 }, 3).bloquear).toBe(true)
    expect(debeBloquearse({ consecutiveFailures: 2 }, 3).bloquear).toBe(false)
  })

  it('bloquea si la instancia se desconectó', () => {
    expect(debeBloquearse({ consecutiveFailures: 0, instanciaCaida: true }, 3).bloquear).toBe(true)
  })

  it('respeta un umbral configurado distinto', () => {
    expect(debeBloquearse({ consecutiveFailures: 2 }, 2).bloquear).toBe(true)
  })

  it('siempre explica por qué bloquea', () => {
    expect(debeBloquearse({ consecutiveFailures: 3 }, 3).motivo).toContain('3 fallos')
  })
})

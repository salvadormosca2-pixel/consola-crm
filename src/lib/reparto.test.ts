import { describe, expect, it } from 'vitest'

import { capacidadDe, planificarReparto, type CapacidadDeSetter } from './reparto'

function setter(over: Partial<CapacidadDeSetter> & { setterId: string }): CapacidadDeSetter {
  return {
    nombre: over.setterId,
    cupoRestante: 60,
    tandaDiaria: 60,
    pendientes: 0,
    seguimientos: 0,
    activo: true,
    ...over,
  }
}

describe('capacidad de un setter', () => {
  it('con las cuentas frescas puede con su tanda entera', () => {
    expect(capacidadDe(setter({ setterId: 'a' })).capacidad).toBe(60)
  })

  it('los seguimientos del día le comen cupo a los leads nuevos', () => {
    // Salen de la misma cuenta: 60 de cupo menos 20 seguimientos son 40.
    expect(capacidadDe(setter({ setterId: 'a', seguimientos: 20 })).capacidad).toBe(40)
  })

  it('lo que ya tiene sin contactar cuenta contra su tanda', () => {
    expect(capacidadDe(setter({ setterId: 'a', pendientes: 45 })).capacidad).toBe(15)
  })

  it('una cuenta al tope no recibe nada, y lo dice', () => {
    const r = capacidadDe(setter({ setterId: 'a', cupoRestante: 0 }))
    expect(r.capacidad).toBe(0)
    expect(r.motivo).toContain('límite')
  })

  it('un setter pausado no recibe nada', () => {
    const r = capacidadDe(setter({ setterId: 'a', activo: false }))
    expect(r.capacidad).toBe(0)
    expect(r.motivo).toContain('pausado')
  })

  it('manda el más chico entre el cupo y la tanda', () => {
    expect(capacidadDe(setter({ setterId: 'a', cupoRestante: 30, tandaDiaria: 60 })).capacidad).toBe(30)
    expect(capacidadDe(setter({ setterId: 'a', cupoRestante: 60, tandaDiaria: 20 })).capacidad).toBe(20)
  })
})

describe('plan de reparto', () => {
  it('con leads de sobra, cada uno se lleva toda su capacidad', () => {
    const plan = planificarReparto(
      [setter({ setterId: 'a' }), setter({ setterId: 'b', cupoRestante: 30, tandaDiaria: 30 })],
      500,
    )
    expect(plan.tajadas.map((t) => t.cantidad)).toEqual([60, 30])
    expect(plan.total).toBe(90)
    expect(plan.sobran).toBe(410)
    expect(plan.faltan).toBe(0)
  })

  it('nunca entrega más de lo que el setter puede mandar hoy', () => {
    const plan = planificarReparto([setter({ setterId: 'a', cupoRestante: 12 })], 1000)
    expect(plan.tajadas[0]!.cantidad).toBe(12)
  })

  it('cuando no alcanzan, reparte en proporción a la capacidad', () => {
    // 60 y 30 de capacidad, 30 leads: le toca el doble al que puede el doble.
    const plan = planificarReparto(
      [setter({ setterId: 'a' }), setter({ setterId: 'b', cupoRestante: 30, tandaDiaria: 30 })],
      30,
    )
    expect(plan.tajadas.map((t) => t.cantidad)).toEqual([20, 10])
    expect(plan.total).toBe(30)
  })

  it('no deja leads sueltos por el redondeo', () => {
    // Tres capacidades iguales y 10 leads: 3+3+3 dejaría uno colgado.
    const plan = planificarReparto(
      [setter({ setterId: 'a' }), setter({ setterId: 'b' }), setter({ setterId: 'c' })],
      10,
    )
    expect(plan.total).toBe(10)
    expect(plan.tajadas.map((t) => t.cantidad).sort()).toEqual([3, 3, 4])
  })

  it('saltea a los que no tienen cupo y le da todo al que sí', () => {
    const plan = planificarReparto(
      [
        setter({ setterId: 'a', cupoRestante: 0 }),
        setter({ setterId: 'b', activo: false }),
        setter({ setterId: 'c' }),
      ],
      40,
    )
    expect(plan.tajadas.find((t) => t.setterId === 'a')!.cantidad).toBe(0)
    expect(plan.tajadas.find((t) => t.setterId === 'b')!.cantidad).toBe(0)
    expect(plan.tajadas.find((t) => t.setterId === 'c')!.cantidad).toBe(40)
  })

  it('sin nadie con capacidad no reparte nada y el pozo queda intacto', () => {
    const plan = planificarReparto([setter({ setterId: 'a', cupoRestante: 0 })], 800)
    expect(plan.total).toBe(0)
    expect(plan.sobran).toBe(800)
  })

  it('sin leads en el pozo no entrega nada pero informa la capacidad libre', () => {
    const plan = planificarReparto([setter({ setterId: 'a' })], 0)
    expect(plan.total).toBe(0)
    expect(plan.faltan).toBe(60)
  })

  it('mil leads entre tres equipos: nadie se pasa de su cupo', () => {
    const plan = planificarReparto(
      [
        setter({ setterId: 'abril', cupoRestante: 60, tandaDiaria: 60 }),
        setter({ setterId: 'bruno', cupoRestante: 30, tandaDiaria: 30 }),
        setter({ setterId: 'carla', cupoRestante: 60, tandaDiaria: 60, seguimientos: 20 }),
      ],
      1000,
    )
    expect(plan.tajadas.map((t) => t.cantidad)).toEqual([60, 30, 40])
    expect(plan.total).toBe(130)
    expect(plan.sobran).toBe(870)
    for (const t of plan.tajadas) expect(t.cantidad).toBeLessThanOrEqual(t.capacidad)
  })

  it('el reparto es el mismo con los mismos números', () => {
    const equipo = [setter({ setterId: 'a' }), setter({ setterId: 'b' }), setter({ setterId: 'c' })]
    const uno = planificarReparto(equipo, 47)
    const dos = planificarReparto(equipo, 47)
    expect(uno.tajadas).toEqual(dos.tajadas)
  })
})

import { describe, expect, it } from 'vitest'

import { horasHabilesEntre, minutosHabilesEntre, VENTANA_HABIL } from './horas-habiles'

/**
 * El reloj del SLA de la cola de clasificación.
 *
 * Se prueba con la zona fijada en UTC para que el resultado no dependa de dónde
 * corra el CI. Lo que se cuida es que el rojo signifique algo: si contara horas
 * de reloj, todo lo que entra de noche amanecería en rojo y nadie volvería a
 * mirar el color.
 */

const utc = (s: string) => new Date(`${s}Z`)
const habiles = (a: string, b: string) => horasHabilesEntre(utc(a), utc(b), VENTANA_HABIL, 'UTC')

describe('dentro de un mismo día', () => {
  it('cuenta las horas que caen dentro de la ventana', () => {
    expect(habiles('2026-03-10T10:00', '2026-03-10T14:00')).toBe(4)
  })

  it('no cuenta lo que pasa antes de abrir ni después de cerrar', () => {
    // Martes 23:00 → miércoles 03:00: cuatro horas de reloj, cero de trabajo.
    expect(habiles('2026-03-10T23:00', '2026-03-11T03:00')).toBe(0)
  })

  it('recorta contra el borde de la ventana', () => {
    // Arranca a las 07:00 pero el día abre a las 09:00.
    expect(habiles('2026-03-10T07:00', '2026-03-10T11:00')).toBe(2)
    // Termina a las 23:00 pero el día cierra a las 21:00.
    expect(habiles('2026-03-10T19:00', '2026-03-10T23:00')).toBe(2)
  })

  it('un rango invertido o vacío es cero', () => {
    expect(habiles('2026-03-10T14:00', '2026-03-10T10:00')).toBe(0)
    expect(habiles('2026-03-10T10:00', '2026-03-10T10:00')).toBe(0)
  })
})

describe('cruzando días', () => {
  it('el que contestó de noche recién empieza a correr cuando abre el día', () => {
    // Es el caso que motiva todo esto: martes 23:00 → miércoles 11:00 son dos
    // horas hábiles, no doce. Con horas de reloj ya estaría en rojo.
    expect(habiles('2026-03-10T23:00', '2026-03-11T11:00')).toBe(2)
  })

  it('suma un día entero de ventana por cada día completo en el medio', () => {
    // Martes 10:00 → jueves 10:00: resto del martes (11) + miércoles (12) +
    // jueves hasta las 10 (1).
    expect(habiles('2026-03-10T10:00', '2026-03-12T10:00')).toBe(24)
  })
})

describe('los domingos no cuentan', () => {
  it('salta el domingo entero', () => {
    // Sábado 20:00 → lunes 10:00. Sábado: 1 h. Domingo: nada. Lunes: 1 h.
    expect(habiles('2026-03-14T20:00', '2026-03-16T10:00')).toBe(2)
  })

  it('un domingo entero no suma nada', () => {
    expect(habiles('2026-03-15T00:00', '2026-03-15T23:59')).toBe(0)
  })

  it('con la ventana sin feriado dominical, el domingo sí cuenta', () => {
    const abierto = { ...VENTANA_HABIL, sinDomingos: false }
    expect(horasHabilesEntre(utc('2026-03-15T10:00'), utc('2026-03-15T14:00'), abierto, 'UTC')).toBe(4)
  })
})

describe('el SLA de cuatro horas', () => {
  it('no marca en rojo lo que entró anoche y se mira a media mañana', () => {
    expect(habiles('2026-03-10T22:00', '2026-03-11T12:00')).toBeLessThanOrEqual(4)
  })

  it('sí marca lo que lleva un día hábil entero sin tocar', () => {
    expect(habiles('2026-03-10T09:00', '2026-03-11T09:00')).toBeGreaterThan(4)
  })
})

describe('minutos', () => {
  it('devuelve minutos, no horas redondeadas', () => {
    expect(minutosHabilesEntre(utc('2026-03-10T10:00'), utc('2026-03-10T10:30'), VENTANA_HABIL, 'UTC'))
      .toBe(30)
  })

  it('una ventana invertida no rompe: da cero', () => {
    const rota = { desde: '21:00', hasta: '09:00', sinDomingos: true }
    expect(minutosHabilesEntre(utc('2026-03-10T10:00'), utc('2026-03-11T10:00'), rota, 'UTC')).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'

import { cuantosEntregar, frenoDelEnvio, leerCupo, type CuentaDeSetter } from './setters-cupo'

function cuenta(over: Partial<CuentaDeSetter> & { id: string }): CuentaDeSetter {
  return {
    igUsername: over.id,
    cupoDiario: 30,
    enviadosHoy: 0,
    orden: 1,
    activa: true,
    ...over,
  }
}

describe('leerCupo', () => {
  it('empieza en la primera cuenta cuando el setter no confirmó ninguna', () => {
    const e = leerCupo([cuenta({ id: 'b', orden: 2 }), cuenta({ id: 'a', orden: 1 })], null)
    expect(e.activa?.id).toBe('a')
    expect(e.puedeEnviar).toBe(true)
    expect(e.cupoTotal).toBe(60)
    expect(e.restanteTotal).toBe(60)
  })

  it('bloquea la pantalla al llegar a 30 con la cuenta activa', () => {
    const e = leerCupo(
      [cuenta({ id: 'a', orden: 1, enviadosHoy: 30 }), cuenta({ id: 'b', orden: 2 })],
      'a',
    )
    expect(e.bloqueadoPorCambio).toBe(true)
    expect(e.puedeEnviar).toBe(false)
    expect(e.siguiente?.id).toBe('b')
    expect(e.terminoElDia).toBe(false)
  })

  it('no se cambia de cuenta solo: la activa al tope sigue siendo la activa', () => {
    // Si se resolviera solo, el setter mandaría desde una cuenta a la que
    // todavía no cambió en Instagram, y la marca quedaría en la cuenta
    // equivocada. Tiene que confirmar el cambio.
    const e = leerCupo(
      [cuenta({ id: 'a', orden: 1, enviadosHoy: 30 }), cuenta({ id: 'b', orden: 2 })],
      'a',
    )
    expect(e.activa?.id).toBe('a')
  })

  it('con una sola cuenta al tope, el día terminó', () => {
    const e = leerCupo([cuenta({ id: 'a', enviadosHoy: 30 })], 'a')
    expect(e.terminoElDia).toBe(true)
    expect(e.bloqueadoPorCambio).toBe(false)
    expect(e.siguiente).toBeNull()
  })

  it('con las dos cuentas al tope, el día terminó y no hay a dónde cambiar', () => {
    const e = leerCupo(
      [
        cuenta({ id: 'a', orden: 1, enviadosHoy: 30 }),
        cuenta({ id: 'b', orden: 2, enviadosHoy: 30 }),
      ],
      'b',
    )
    expect(e.terminoElDia).toBe(true)
    expect(e.bloqueadoPorCambio).toBe(false)
    expect(e.puedeEnviar).toBe(false)
  })

  it('ignora las cuentas desactivadas para el cupo total', () => {
    const e = leerCupo(
      [cuenta({ id: 'a', orden: 1 }), cuenta({ id: 'b', orden: 2, activa: false })],
      null,
    )
    expect(e.cupoTotal).toBe(30)
    expect(e.siguiente).toBeNull()
  })

  it('cae a una cuenta con lugar si la confirmada ya no existe', () => {
    const e = leerCupo([cuenta({ id: 'a' })], 'borrada')
    expect(e.activa?.id).toBe('a')
  })

  it('sin cuentas cargadas no puede enviar y el día está terminado', () => {
    const e = leerCupo([], null)
    expect(e.activa).toBeNull()
    expect(e.puedeEnviar).toBe(false)
    expect(e.terminoElDia).toBe(true)
  })

  it('respeta un cupo distinto por cuenta', () => {
    const e = leerCupo([cuenta({ id: 'a', cupoDiario: 15, enviadosHoy: 15 })], 'a')
    expect(e.terminoElDia).toBe(true)
  })
})

describe('cuantosEntregar', () => {
  const dosCuentas = [cuenta({ id: 'a', orden: 1 }), cuenta({ id: 'b', orden: 2 })]

  it('entrega la tanda completa con las cuentas frescas', () => {
    const estado = leerCupo(dosCuentas, null)
    expect(cuantosEntregar({ estado, tandaDiaria: 60, pendientes: 0 })).toBe(60)
  })

  it('no entrega nada si las dos cuentas llegaron al límite', () => {
    const estado = leerCupo(
      [
        cuenta({ id: 'a', orden: 1, enviadosHoy: 30 }),
        cuenta({ id: 'b', orden: 2, enviadosHoy: 30 }),
      ],
      'b',
    )
    expect(cuantosEntregar({ estado, tandaDiaria: 60, pendientes: 0 })).toBe(0)
  })

  it('los seguimientos del día no le quitan leads nuevos', () => {
    // El cupo es el presupuesto de abrir chats nuevos. Un seguimiento sale en
    // uno que ya está abierto: descontarlo le entregaba menos leads al que
    // mejor trabaja a los que ya contestaron.
    const estado = leerCupo([cuenta({ id: 'a' })], null)
    expect(cuantosEntregar({ estado, tandaDiaria: 60, pendientes: 0 })).toBe(30)
  })

  it('descuenta lo que ya tiene sin trabajar', () => {
    const estado = leerCupo(dosCuentas, null)
    expect(
      cuantosEntregar({ estado, tandaDiaria: 60, pendientes: 45 }),
    ).toBe(15)
  })

  it('la tanda diaria puede ser más chica que el cupo', () => {
    const estado = leerCupo(dosCuentas, null)
    expect(cuantosEntregar({ estado, tandaDiaria: 20, pendientes: 0 })).toBe(20)
  })

  it('nunca devuelve un número negativo', () => {
    const estado = leerCupo([cuenta({ id: 'a', enviadosHoy: 28 })], 'a')
    expect(cuantosEntregar({ estado, tandaDiaria: 60, pendientes: 10 })).toBe(0)
  })
})

/**
 * Qué frena el cupo y qué no.
 *
 * Es el bug que se vio en la calle: la app dejaba abrir Instagram, el setter
 * mandaba la oferta, y al tocar "Enviado" saltaba "llegaste al límite". El
 * mensaje ya estaba mandado y el lead quedaba sin registrar, sin clasificar y
 * sin próximo paso.
 */
describe('frenoDelEnvio', () => {
  it('la oferta sale aunque la cuenta esté al tope', () => {
    expect(
      frenoDelEnvio({
        gastaCupo: false,
        restanteDeLaCuenta: 0,
        esDelHilo: true,
        bloqueadoPorCambio: true,
      }),
    ).toEqual({ frena: false })
  })

  it('un seguimiento en un hilo abierto tampoco se frena', () => {
    expect(
      frenoDelEnvio({
        gastaCupo: false,
        restanteDeLaCuenta: 0,
        esDelHilo: true,
        bloqueadoPorCambio: false,
      }).frena,
    ).toBe(false)
  })

  it('una apertura con la cuenta activa al tope manda a cambiar de cuenta', () => {
    expect(
      frenoDelEnvio({
        gastaCupo: true,
        restanteDeLaCuenta: 0,
        esDelHilo: false,
        bloqueadoPorCambio: true,
      }),
    ).toEqual({ frena: true, motivo: 'cambiar_de_cuenta' })
  })

  it('un reintento sobre un hilo cuya cuenta llegó al tope espera a mañana', () => {
    // Cambiar de cuenta no ayuda: la conversación vive en esa.
    expect(
      frenoDelEnvio({
        gastaCupo: true,
        restanteDeLaCuenta: 0,
        esDelHilo: true,
        bloqueadoPorCambio: false,
      }),
    ).toEqual({ frena: true, motivo: 'cuenta_al_tope' })
  })

  it('una apertura con cupo libre sale', () => {
    expect(
      frenoDelEnvio({
        gastaCupo: true,
        restanteDeLaCuenta: 5,
        esDelHilo: false,
        bloqueadoPorCambio: false,
      }).frena,
    ).toBe(false)
  })
})

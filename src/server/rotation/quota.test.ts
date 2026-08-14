import { describe, expect, it } from 'vitest'

import { OPS_CONFIG_DEFAULT, opsConfigSchema } from '@/lib/ops-config'

import {
  CHECKLIST_PREPARACION,
  cupoEfectivo,
  decidirCalentamiento,
  demoraAleatoriaSeg,
  esperaMinimaSeg,
  faltantesDePreparacion,
  inicioDeFechaUtc,
  partesLocales,
  preparacionCompleta,
  rangoDelDiaUtc,
  techoParaLaConsola,
  ventanaAbierta,
  type CuentaParaCupo,
} from './quota'

const TZ = 'America/Argentina/Catamarca'
const cfg = OPS_CONFIG_DEFAULT

const CUENTA: CuentaParaCupo = {
  status: 'activa',
  dailyCap: 30,
  minGapSeconds: 240,
  warmupDay: null,
  windowStart: '09:00',
  windowEnd: '20:00',
}

describe('cupoEfectivo', () => {
  it('una cuenta activa usa su cupo diario', () => {
    expect(cupoEfectivo(CUENTA, cfg)).toBe(30)
  })

  it('mientras calienta, el cupo lo fija la escala y NO daily_cap', () => {
    // Es la regla central del calentamiento: un número nuevo no manda 30
    // porque alguien escribió 30 en la ficha.
    const escala = [5, 8, 12, 16, 21, 26, 30]
    for (let dia = 1; dia <= 7; dia++) {
      const c = { ...CUENTA, status: 'calentando' as const, warmupDay: dia, dailyCap: 30 }
      expect(cupoEfectivo(c, cfg)).toBe(escala[dia - 1])
    }
  })

  it('una cuenta pausada, bloqueada o sin preparar tiene cupo cero', () => {
    for (const status of ['pausada', 'bloqueada', 'esperando_preparacion'] as const) {
      expect(cupoEfectivo({ ...CUENTA, status }, cfg)).toBe(0)
    }
  })

  it('un día de calentamiento fuera de la escala se clampea al último', () => {
    expect(cupoEfectivo({ ...CUENTA, status: 'calentando', warmupDay: 99 }, cfg)).toBe(30)
    expect(cupoEfectivo({ ...CUENTA, status: 'calentando', warmupDay: 0 }, cfg)).toBe(5)
  })
})

describe('techoParaLaConsola', () => {
  /*
   * Con Chatwoot hay dos emisores. La consola no puede pasarse porque reserva
   * bajo transacción, pero los mensajes escritos a mano en Chatwoot se cuentan
   * recién cuando llega el webhook. El colchón cubre esa ventana.
   */
  it('sin colchón, el techo es el cupo', () => {
    const sinColchon = opsConfigSchema.parse({ colchonParaRespuestas: 0 })
    expect(techoParaLaConsola(CUENTA, sinColchon)).toBe(30)
  })

  it('con colchón, la consola se frena antes', () => {
    const con = opsConfigSchema.parse({ colchonParaRespuestas: 3 })
    expect(techoParaLaConsola(CUENTA, con)).toBe(27)
  })

  it('nunca deja el techo en cero, ni con un colchón enorme', () => {
    // El día 1 del calentamiento el cupo es 5: un colchón de 10 no puede dejar
    // el número mudo.
    const enorme = opsConfigSchema.parse({ colchonParaRespuestas: 50 })
    expect(techoParaLaConsola(CUENTA, enorme)).toBe(1)
    const dia1 = { ...CUENTA, status: 'calentando' as const, warmupDay: 1 }
    expect(techoParaLaConsola(dia1, enorme)).toBe(1)
  })

  it('una cuenta que no puede enviar tiene techo cero, no uno', () => {
    for (const status of ['pausada', 'bloqueada', 'esperando_preparacion'] as const) {
      expect(techoParaLaConsola({ ...CUENTA, status }, cfg)).toBe(0)
    }
  })

  it('el colchón se aplica también durante el calentamiento', () => {
    const con = opsConfigSchema.parse({ colchonParaRespuestas: 2 })
    const dia7 = { ...CUENTA, status: 'calentando' as const, warmupDay: 7 }
    expect(cupoEfectivo(dia7, con)).toBe(30)
    expect(techoParaLaConsola(dia7, con)).toBe(28)
  })

  it('el techo nunca supera el cupo', () => {
    for (const colchon of [0, 1, 5, 29, 100]) {
      const c = opsConfigSchema.parse({ colchonParaRespuestas: colchon })
      expect(techoParaLaConsola(CUENTA, c)).toBeLessThanOrEqual(cupoEfectivo(CUENTA, c))
    }
  })
})

describe('esperaMinimaSeg', () => {
  it('una cuenta activa respeta los 4 minutos', () => {
    expect(esperaMinimaSeg(CUENTA, cfg)).toBe(240)
  })

  it('respeta una espera mayor configurada por cuenta', () => {
    expect(esperaMinimaSeg({ ...CUENTA, minGapSeconds: 600 }, cfg)).toBe(600)
  })

  it('durante el calentamiento reparte los envíos en toda la ventana', () => {
    // Día 1: 5 mensajes en 11 h de ventana = 132 min entre envíos.
    // Con los 8 min del piso, los 5 entrarían en 40 min, que es peor que no calentar.
    const dia1 = { ...CUENTA, status: 'calentando' as const, warmupDay: 1 }
    const espera = esperaMinimaSeg(dia1, cfg)
    expect(espera).toBe(Math.floor((11 * 3600) / 5))
    expect(espera).toBeGreaterThan(cfg.calentamientoEsperaMinimaSeg)
  })

  it('el piso de 8 minutos rige cuando el cupo ya subió', () => {
    // Día 7: 30 mensajes en 11 h = 22 min... sigue arriba del piso.
    // Con una ventana corta, en cambio, gana el piso.
    const corta = {
      ...CUENTA,
      status: 'calentando' as const,
      warmupDay: 7,
      windowStart: '09:00',
      windowEnd: '11:00',
    }
    expect(esperaMinimaSeg(corta, cfg)).toBe(cfg.calentamientoEsperaMinimaSeg)
  })

  it('nunca deja pasar los envíos del día de golpe', () => {
    for (let dia = 1; dia <= 7; dia++) {
      const c = { ...CUENTA, status: 'calentando' as const, warmupDay: dia }
      const espera = esperaMinimaSeg(c, cfg)
      const cupo = cupoEfectivo(c, cfg)
      // El cupo del día ocupa al menos el 90% de la ventana.
      expect(espera * (cupo - 1)).toBeGreaterThanOrEqual(11 * 3600 * 0.9 - espera)
    }
  })
})

describe('ventanaAbierta', () => {
  const enCatamarca = (fecha: string, hora: string) => inicioDeFechaUtc(fecha, TZ).getTime() + horaMs(hora)
  const horaMs = (hhmm: string) => {
    const [h = '0', m = '0'] = hhmm.split(':')
    return (Number(h) * 60 + Number(m)) * 60_000
  }

  it('abre dentro de la ventana un día hábil', () => {
    // Jueves 13 de agosto de 2026, 14:00 en Catamarca.
    const r = ventanaAbierta(CUENTA, cfg, new Date(enCatamarca('2026-08-13', '14:00')), TZ)
    expect(r.abierta).toBe(true)
  })

  it('cierra antes de las 9 y desde las 20', () => {
    const antes = ventanaAbierta(CUENTA, cfg, new Date(enCatamarca('2026-08-13', '08:59')), TZ)
    expect(antes).toEqual({ abierta: false, motivo: 'ventana' })

    const despues = ventanaAbierta(CUENTA, cfg, new Date(enCatamarca('2026-08-13', '20:00')), TZ)
    expect(despues).toEqual({ abierta: false, motivo: 'ventana' })
  })

  it('los domingos no se envía ni en horario', () => {
    // Domingo 16 de agosto de 2026, mediodía.
    const r = ventanaAbierta(CUENTA, cfg, new Date(enCatamarca('2026-08-16', '12:00')), TZ)
    expect(r).toEqual({ abierta: false, motivo: 'domingo' })
  })

  it('los sábados sí se envía con la configuración por defecto', () => {
    const r = ventanaAbierta(CUENTA, cfg, new Date(enCatamarca('2026-08-15', '12:00')), TZ)
    expect(r.abierta).toBe(true)
  })

  it('respeta una configuración que también excluya sábados', () => {
    const sinSabados = opsConfigSchema.parse({ diasActivos: [1, 2, 3, 4, 5] })
    const r = ventanaAbierta(CUENTA, sinSabados, new Date(enCatamarca('2026-08-15', '12:00')), TZ)
    expect(r.abierta).toBe(false)
  })
})

describe('rangoDelDiaUtc', () => {
  it('la fecha operativa cambia a medianoche de Catamarca, no de UTC', () => {
    // Catamarca es UTC-3 todo el año. Las 02:00 UTC del 14 son las 23:00 del 13.
    const at = new Date('2026-08-14T02:00:00Z')
    expect(rangoDelDiaUtc(at, TZ).fecha).toBe('2026-08-13')

    const despues = new Date('2026-08-14T03:00:00Z')
    expect(rangoDelDiaUtc(despues, TZ).fecha).toBe('2026-08-14')
  })

  it('el rango arranca a las 03:00 UTC y dura 24 h', () => {
    const { desde, hasta } = rangoDelDiaUtc(new Date('2026-08-13T15:00:00Z'), TZ)
    expect(desde.toISOString()).toBe('2026-08-13T03:00:00.000Z')
    expect(hasta.toISOString()).toBe('2026-08-14T03:00:00.000Z')
  })

  it('un envío justo antes de medianoche local cae en el día que corresponde', () => {
    const { desde, hasta } = rangoDelDiaUtc(new Date('2026-08-14T02:59:59Z'), TZ)
    const envio = new Date('2026-08-14T02:59:59Z')
    expect(envio >= desde && envio < hasta).toBe(true)
  })
})

describe('partesLocales', () => {
  it('resuelve la medianoche sin salirse del día', () => {
    const p = partesLocales(new Date('2026-08-13T03:00:00Z'), TZ)
    expect(p.fecha).toBe('2026-08-13')
    expect(p.minutos).toBe(0)
  })
})

describe('decidirCalentamiento', () => {
  const base = { warmupDay: 3, warmupLastAdvancedOn: null, warmupRepeats: 0 }
  const dia = { fecha: '2026-08-13', enviados: 12, tasaRespuesta: 0.2, huboProblema: false }

  it('avanza un día cuando el número mandó y anduvo bien', () => {
    expect(decidirCalentamiento(base, dia, cfg)).toEqual({ accion: 'avanza', a: 4 })
  })

  it('no avanza si el número no mandó nada ese día', () => {
    // El calentamiento cuenta días de uso, no del almanaque: un número que no
    // envió el martes no puede saltar de 5 a 16 el miércoles.
    expect(decidirCalentamiento(base, { ...dia, enviados: 0 }, cfg)).toEqual({ accion: 'sin_cambio' })
  })

  it('no avanza dos veces el mismo día operativo', () => {
    const yaAvanzo = { ...base, warmupLastAdvancedOn: '2026-08-13' }
    expect(decidirCalentamiento(yaAvanzo, dia, cfg)).toEqual({ accion: 'sin_cambio' })
  })

  it('repite el día si hubo un fallo de entrega', () => {
    const r = decidirCalentamiento(base, { ...dia, huboProblema: true }, cfg)
    expect(r).toMatchObject({ accion: 'repite', dia: 3, repeticiones: 1 })
  })

  it('repite el día si la respuesta quedó por debajo del 10%', () => {
    const r = decidirCalentamiento(base, { ...dia, tasaRespuesta: 0.05 }, cfg)
    expect(r).toMatchObject({ accion: 'repite', dia: 3, repeticiones: 1 })
  })

  it('a la tercera repetición pausa el número en vez de insistir', () => {
    const dosRepeticiones = { ...base, warmupRepeats: 2 }
    const r = decidirCalentamiento(dosRepeticiones, { ...dia, huboProblema: true }, cfg)
    expect(r.accion).toBe('pausa')
  })

  it('termina el calentamiento al cerrar el último día', () => {
    const ultimo = { ...base, warmupDay: 7 }
    expect(decidirCalentamiento(ultimo, { ...dia, enviados: 30 }, cfg)).toEqual({ accion: 'termina' })
  })

  it('no pasa a activa si terminó con menos del 10% de respuestas', () => {
    const ultimo = { ...base, warmupDay: 7 }
    const r = decidirCalentamiento(ultimo, { ...dia, enviados: 30, tasaRespuesta: 0.03 }, cfg)
    // Antes de llegar al final, la baja respuesta hace repetir; en el último día
    // el número queda pausado con aviso en lugar de escalar.
    expect(['repite', 'termina_con_baja_respuesta', 'pausa']).toContain(r.accion)
    expect(r.accion).not.toBe('termina')
  })

  it('recorre la escala completa de 5 a 30 en 7 días de uso', () => {
    let estado = { warmupDay: 1, warmupLastAdvancedOn: null as string | null, warmupRepeats: 0 }
    const cupos: number[] = []

    for (let i = 0; i < 7; i++) {
      const c: CuentaParaCupo = { ...CUENTA, status: 'calentando', warmupDay: estado.warmupDay }
      cupos.push(cupoEfectivo(c, cfg))

      const r = decidirCalentamiento(
        estado,
        { fecha: `2026-08-${String(10 + i).padStart(2, '0')}`, enviados: 5, tasaRespuesta: 0.2, huboProblema: false },
        cfg,
      )
      if (r.accion === 'avanza') {
        estado = { ...estado, warmupDay: r.a, warmupLastAdvancedOn: `2026-08-${String(10 + i).padStart(2, '0')}` }
      }
    }

    expect(cupos).toEqual([5, 8, 12, 16, 21, 26, 30])
  })
})

describe('checklist de preparación', () => {
  const completo = Object.fromEntries(CHECKLIST_PREPARACION.map((i) => [i.key, true]))

  it('reconoce un checklist completo', () => {
    expect(preparacionCompleta(completo)).toBe(true)
    expect(faltantesDePreparacion(completo)).toEqual([])
  })

  it('un checklist vacío no está completo', () => {
    expect(preparacionCompleta({})).toBe(false)
    expect(preparacionCompleta(null)).toBe(false)
    expect(faltantesDePreparacion({})).toHaveLength(CHECKLIST_PREPARACION.length)
  })

  it('falta uno solo y sigue incompleto', () => {
    const casi = { ...completo, instancia: false }
    expect(preparacionCompleta(casi)).toBe(false)
    expect(faltantesDePreparacion(casi)).toHaveLength(1)
  })

  it('no acepta valores que no sean true', () => {
    const truculento = Object.fromEntries(CHECKLIST_PREPARACION.map((i) => [i.key, 'sí']))
    expect(preparacionCompleta(truculento)).toBe(false)
  })
})

describe('demoraAleatoriaSeg', () => {
  it('queda siempre dentro del rango configurado', () => {
    for (let i = 0; i <= 100; i++) {
      const d = demoraAleatoriaSeg(cfg, () => i / 100)
      expect(d).toBeGreaterThanOrEqual(90)
      expect(d).toBeLessThanOrEqual(300)
    }
  })

  it('no devuelve siempre el mismo valor', () => {
    const vistos = new Set<number>()
    for (let i = 0; i < 50; i++) vistos.add(demoraAleatoriaSeg(cfg))
    expect(vistos.size).toBeGreaterThan(5)
  })
})

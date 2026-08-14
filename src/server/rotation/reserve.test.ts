import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { OPS_CONFIG_DEFAULT, opsConfigSchema } from '@/lib/ops-config'

import { claveIdempotente, deshacerEnvio, reservarYCrearMensaje } from './reserve'
import { elegirCuenta, intercalarPorCuenta } from './select'
import { contarCupo, crearContacto, crearCuenta, crearDb, crearPool, limpiar } from './test-db'

/**
 * Tests de la contabilidad de cupos contra Postgres real.
 *
 * Son la garantía de que los 10 números no se queman: si alguno de estos falla,
 * el sistema puede pasarse del cupo y eso es exactamente lo que rompe el negocio.
 */

let pool: Pool
let db: ReturnType<typeof crearDb>

/**
 * Config de los tests de cupo: sin espera entre envíos.
 *
 * La espera mínima global es un piso duro (`max(min_gap_seconds de la cuenta,
 * esperaMismaCuentaSeg global)`), a propósito: así nadie puede desactivarla
 * poniendo 0 en la ficha de una cuenta. Para probar el CUPO hay que sacarla de
 * la ecuación, y la espera tiene su propio test más abajo con el valor real.
 */
const cfg = opsConfigSchema.parse({ esperaMismaCuentaSeg: 0, colchonParaRespuestas: 0 })

beforeAll(() => {
  pool = crearPool()
  db = crearDb(pool)
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await limpiar(pool)
})

async function mandar(
  accountId: string,
  contactId: string,
  opts: { paso?: number | null; ahora?: Date; status?: 'enviado' | 'abierto' } = {},
) {
  return reservarYCrearMensaje(db, {
    accountId,
    cfg,
    ahora: opts.ahora,
    ignorarVentana: true,
    mensaje: {
      contactId,
      channel: 'whatsapp',
      body: 'Hola, te escribo por lo del pack.',
      sendMode: 'chatwoot',
      sequenceStep: opts.paso === undefined ? null : opts.paso,
      status: opts.status ?? 'enviado',
    },
  })
}

describe('reserva de cupo', () => {
  it('respeta el cupo con 100 intentos en paralelo sobre la misma cuenta', async () => {
    const cuenta = await crearCuenta(pool, { dailyCap: 30, minGapSeconds: 0 })
    const contactos = await Promise.all(
      Array.from({ length: 100 }, (_, i) => crearContacto(pool, i)),
    )

    const resultados = await Promise.all(contactos.map((c) => mandar(cuenta, c)))

    const ok = resultados.filter((r) => r.ok)
    const porCupo = resultados.filter((r) => !r.ok && r.motivo === 'cupo')

    expect(ok).toHaveLength(30)
    expect(porCupo).toHaveLength(70)
    // Y la base coincide: no alcanza con que la función diga que rechazó.
    expect(await contarCupo(pool, cuenta)).toBe(30)
  }, 60_000)

  it('con 10 cuentas y 500 intentos, ninguna se pasa de su cupo', async () => {
    const cuentas = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        crearCuenta(pool, { code: `WA-C${i}`, dailyCap: 30, minGapSeconds: 0 }),
      ),
    )
    const contactos = await Promise.all(
      Array.from({ length: 500 }, (_, i) => crearContacto(pool, i)),
    )

    // Se reparten en round-robin a propósito, para que varias transacciones
    // peleen por la misma cuenta al mismo tiempo.
    const intentos = contactos.map((c, i) => mandar(cuentas[i % 10]!, c))
    const resultados = await Promise.all(intentos)

    expect(resultados.filter((r) => r.ok)).toHaveLength(300)
    for (const cuenta of cuentas) {
      expect(await contarCupo(pool, cuenta)).toBe(30)
    }
  }, 90_000)

  it('la misma clave idempotente disparada 20 veces en paralelo crea un solo mensaje', async () => {
    const cuenta = await crearCuenta(pool, { dailyCap: 30, minGapSeconds: 0 })
    const contacto = await crearContacto(pool)

    const resultados = await Promise.all(
      Array.from({ length: 20 }, () => mandar(cuenta, contacto, { paso: 1 })),
    )

    expect(resultados.filter((r) => r.ok)).toHaveLength(1)
    expect(resultados.filter((r) => !r.ok && r.motivo === 'duplicado')).toHaveLength(19)
    expect(await contarCupo(pool, cuenta)).toBe(1)
  }, 60_000)

  it('la caché envenenada no permite pasarse del cupo, y se corrige sola', async () => {
    const cuenta = await crearCuenta(pool, { dailyCap: 5, minGapSeconds: 0 })
    const contactos = await Promise.all(Array.from({ length: 6 }, (_, i) => crearContacto(pool, i)))

    for (let i = 0; i < 5; i++) {
      const r = await mandar(cuenta, contactos[i]!)
      expect(r.ok).toBe(true)
    }

    // Se miente el contador a mano: dice 0 cuando en realidad hay 5.
    await pool.query('update messaging_accounts set sent_today = 0 where id = $1', [cuenta])

    const r = await mandar(cuenta, contactos[5]!)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toBe('cupo')
    expect(await contarCupo(pool, cuenta)).toBe(5)

    // Y quedó registrada la corrección.
    const ev = await pool.query<{ n: string }>(
      `select count(*) as n from events where type = 'cupo_corregido' and account_id = $1`,
      [cuenta],
    )
    expect(Number(ev.rows[0]!.n)).toBeGreaterThan(0)

    // La caché quedó igual a la realidad.
    const c = await pool.query<{ sent_today: number }>(
      'select sent_today from messaging_accounts where id = $1',
      [cuenta],
    )
    expect(c.rows[0]!.sent_today).toBe(5)
  }, 60_000)

  it('un mensaje solo abierto no consume cupo', async () => {
    const cuenta = await crearCuenta(pool, { dailyCap: 3, minGapSeconds: 0 })
    const contactos = await Promise.all(Array.from({ length: 5 }, (_, i) => crearContacto(pool, i)))

    for (const c of contactos) {
      const r = await mandar(cuenta, c, { status: 'abierto' })
      expect(r.ok).toBe(true)
    }

    // Cinco chats abiertos y el cupo intacto: si abro y no mando, el sistema no
    // puede creer que mandé.
    expect(await contarCupo(pool, cuenta)).toBe(0)
    const conf = await mandar(cuenta, await crearContacto(pool, 99))
    expect(conf.ok).toBe(true)
  }, 60_000)

  it('deshacer libera cupo, y bajo carga entran exactamente los que se liberaron', async () => {
    const cuenta = await crearCuenta(pool, { dailyCap: 30, minGapSeconds: 0 })
    const contactos = await Promise.all(
      Array.from({ length: 40 }, (_, i) => crearContacto(pool, i)),
    )

    const primeros = await Promise.all(contactos.slice(0, 30).map((c) => mandar(cuenta, c)))
    const ids = primeros.filter((r) => r.ok).map((r) => (r.ok ? r.messageId : ''))
    expect(
      primeros.filter((r) => !r.ok).map((r) => (r.ok ? '' : `${r.motivo}: ${r.detalle}`)),
    ).toEqual([])
    expect(ids).toHaveLength(30)

    for (const id of ids.slice(0, 5)) {
      const d = await deshacerEnvio(db, id, null)
      expect(d.ok).toBe(true)
    }
    expect(await contarCupo(pool, cuenta)).toBe(25)

    // 10 intentos en paralelo sobre 5 lugares libres.
    const nuevos = await Promise.all(contactos.slice(30, 40).map((c) => mandar(cuenta, c)))
    expect(nuevos.filter((r) => r.ok)).toHaveLength(5)
    expect(await contarCupo(pool, cuenta)).toBe(30)
  }, 60_000)

  it('no se puede deshacer dos veces el mismo envío', async () => {
    const cuenta = await crearCuenta(pool, { dailyCap: 5, minGapSeconds: 0 })
    const r = await mandar(cuenta, await crearContacto(pool))
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect((await deshacerEnvio(db, r.messageId, null)).ok).toBe(true)
    const segunda = await deshacerEnvio(db, r.messageId, null)
    expect(segunda.ok).toBe(false)
    expect(await contarCupo(pool, cuenta)).toBe(0)
  })

  it('respeta la espera mínima entre dos envíos de la misma cuenta', async () => {
    const cuenta = await crearCuenta(pool, { dailyCap: 30, minGapSeconds: 240 })
    const a = await crearContacto(pool, 1)
    const b = await crearContacto(pool, 2)

    const conEspera = (contactId: string, ahora: Date) =>
      reservarYCrearMensaje(db, {
        accountId: cuenta,
        cfg: OPS_CONFIG_DEFAULT,
        ahora,
        ignorarVentana: true,
        mensaje: { contactId, channel: 'whatsapp', body: 'hola', sendMode: 'chatwoot', sequenceStep: 1 },
      })

    const t0 = new Date('2026-08-13T15:00:00Z')
    expect((await conEspera(a, t0)).ok).toBe(true)

    // Tres minutos después todavía no.
    const temprano = await conEspera(b, new Date(t0.getTime() + 3 * 60_000))
    expect(temprano.ok).toBe(false)
    if (!temprano.ok) expect(temprano.motivo).toBe('espera')

    // A los cinco, sí.
    expect((await conEspera(b, new Date(t0.getTime() + 5 * 60_000))).ok).toBe(true)
  })

  it('la espera global no se puede desactivar poniendo 0 en la ficha de la cuenta', async () => {
    // Es la defensa que evita que un descuido en una ficha permita una ráfaga.
    const cuenta = await crearCuenta(pool, { dailyCap: 30, minGapSeconds: 0 })
    const a = await crearContacto(pool, 1)
    const b = await crearContacto(pool, 2)
    const t0 = new Date('2026-08-13T15:00:00Z')

    const conDefault = (contactId: string, ahora: Date) =>
      reservarYCrearMensaje(db, {
        accountId: cuenta,
        cfg: OPS_CONFIG_DEFAULT,
        ahora,
        ignorarVentana: true,
        mensaje: { contactId, channel: 'whatsapp', body: 'hola', sendMode: 'chatwoot', sequenceStep: 1 },
      })

    expect((await conDefault(a, t0)).ok).toBe(true)
    const seguido = await conDefault(b, new Date(t0.getTime() + 60_000))
    expect(seguido.ok).toBe(false)
    if (!seguido.ok) expect(seguido.motivo).toBe('espera')
  })

  it('una cuenta pausada, bloqueada o sin preparar no manda', async () => {
    for (const status of ['pausada', 'bloqueada', 'esperando_preparacion'] as const) {
      const cuenta = await crearCuenta(pool, { code: `WA-${status.slice(0, 4)}`, status })
      const r = await mandar(cuenta, await crearContacto(pool))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.motivo).toBe('no_operativa')
    }
  })

  it('durante el calentamiento el cupo lo fija la escala, no daily_cap', async () => {
    // daily_cap dice 30, pero es el día 1 del calentamiento: entran 5.
    const cuenta = await crearCuenta(pool, {
      status: 'calentando',
      warmupDay: 1,
      dailyCap: 30,
      minGapSeconds: 0,
      windowStart: '09:00',
      windowEnd: '20:00',
    })
    const contactos = await Promise.all(Array.from({ length: 8 }, (_, i) => crearContacto(pool, i)))

    // Los envíos van espaciados: durante el calentamiento la espera reparte el
    // cupo del día en toda la ventana (11 h ÷ 5 ≈ 132 min), así que en paralelo
    // entraría uno solo. Acá se prueba el CUPO, y el espaciado tiene su test aparte.
    //
    // Arrancan a la 01:00 de Catamarca y van cada 2 h 15 para que los 8 caigan
    // dentro del mismo día operativo: si cruzaran la medianoche local, el cupo
    // se reiniciaría y entrarían más de 5 — que es justamente lo correcto.
    const base = new Date('2026-08-13T04:00:00Z')
    const resultados = []
    for (let i = 0; i < contactos.length; i++) {
      resultados.push(
        await mandar(cuenta, contactos[i]!, {
          ahora: new Date(base.getTime() + i * 8100 * 1000),
        }),
      )
    }

    expect(resultados.filter((x) => x.ok)).toHaveLength(5)
    expect(resultados.filter((x) => !x.ok && x.motivo === 'cupo')).toHaveLength(3)
    expect(await contarCupo(pool, cuenta)).toBe(5)
  }, 60_000)

  it('durante el calentamiento los envíos quedan repartidos en toda la ventana', async () => {
    const cuenta = await crearCuenta(pool, {
      status: 'calentando',
      warmupDay: 1,
      dailyCap: 30,
      minGapSeconds: 0,
      windowStart: '09:00',
      windowEnd: '20:00',
    })
    const a = await crearContacto(pool, 1)
    const b = await crearContacto(pool, 2)

    const t0 = new Date('2026-08-13T13:00:00Z')
    expect((await mandar(cuenta, a, { ahora: t0 })).ok).toBe(true)

    // Media hora después todavía no: mandar los 5 del día 1 en 40 minutos es
    // peor que no calentar.
    const pronto = await mandar(cuenta, b, { ahora: new Date(t0.getTime() + 30 * 60_000) })
    expect(pronto.ok).toBe(false)
    if (!pronto.ok) expect(pronto.motivo).toBe('espera')

    // A las 2 h 15 (más de 11 h ÷ 5), sí.
    const tarde = await mandar(cuenta, b, { ahora: new Date(t0.getTime() + 135 * 60_000) })
    expect(tarde.ok).toBe(true)
  })

  it('el cupo se cuenta por fecha operativa de Catamarca, no por UTC', async () => {
    const cuenta = await crearCuenta(pool, { dailyCap: 2, minGapSeconds: 0 })
    const c = await Promise.all(Array.from({ length: 4 }, (_, i) => crearContacto(pool, i)))

    // 02:00 UTC del 14 son las 23:00 del 13 en Catamarca: mismo día operativo.
    const nocheDel13 = new Date('2026-08-14T02:00:00Z')
    expect((await mandar(cuenta, c[0]!, { ahora: nocheDel13 })).ok).toBe(true)
    expect((await mandar(cuenta, c[1]!, { ahora: nocheDel13 })).ok).toBe(true)
    const tercero = await mandar(cuenta, c[2]!, { ahora: nocheDel13 })
    expect(tercero.ok).toBe(false)

    // 03:00 UTC ya es el 14 local: el cupo arranca de cero sin ningún cron.
    const madrugadaDel14 = new Date('2026-08-14T03:00:01Z')
    expect((await mandar(cuenta, c[3]!, { ahora: madrugadaDel14 })).ok).toBe(true)
  })

  it('la ventana horaria y los domingos frenan el envío', async () => {
    const cuenta = await crearCuenta(pool, {
      dailyCap: 30,
      minGapSeconds: 0,
      windowStart: '09:00',
      windowEnd: '20:00',
    })
    const c = await crearContacto(pool)

    const conVentana = (ahora: Date) =>
      reservarYCrearMensaje(db, {
        accountId: cuenta,
        cfg,
        ahora,
        mensaje: { contactId: c, channel: 'whatsapp', body: 'hola', sendMode: 'chatwoot', sequenceStep: 1 },
      })

    // Jueves 13/08/2026 a las 07:00 de Catamarca (10:00 UTC es 07:00 local).
    const temprano = await conVentana(new Date('2026-08-13T10:00:00Z'))
    expect(temprano.ok).toBe(false)
    if (!temprano.ok) expect(temprano.motivo).toBe('ventana')

    // Domingo 16/08/2026 al mediodía local.
    const domingo = await conVentana(new Date('2026-08-16T15:00:00Z'))
    expect(domingo.ok).toBe(false)
    if (!domingo.ok) expect(domingo.motivo).toBe('domingo')

    // Jueves a las 14:00 local: pasa.
    expect((await conVentana(new Date('2026-08-13T17:00:00Z'))).ok).toBe(true)
  })
})

describe('colchón para las respuestas a mano en Chatwoot', () => {
  /*
   * Con Chatwoot hay dos emisores: la consola (bajo transacción) y la persona
   * escribiendo a mano, que se cuenta recién cuando llega el webhook. El colchón
   * frena la consola unos mensajes antes del tope para que esas respuestas
   * tengan lugar sin desbordar el cupo real del número.
   */
  const conColchon = opsConfigSchema.parse({ esperaMismaCuentaSeg: 0, colchonParaRespuestas: 3 })

  const mandarConColchon = (accountId: string, contactId: string) =>
    reservarYCrearMensaje(db, {
      accountId,
      cfg: conColchon,
      ignorarVentana: true,
      mensaje: { contactId, channel: 'whatsapp', body: 'hola', sendMode: 'chatwoot' },
    })

  it('la consola se frena antes del tope y deja lugar libre', async () => {
    const cuenta = await crearCuenta(pool, { dailyCap: 30, minGapSeconds: 0 })
    const contactos = await Promise.all(Array.from({ length: 35 }, (_, i) => crearContacto(pool, i)))

    const r = await Promise.all(contactos.map((c) => mandarConColchon(cuenta, c)))
    expect(r.filter((x) => x.ok)).toHaveLength(27)
    expect(await contarCupo(pool, cuenta)).toBe(27)
  }, 60_000)

  it('el rechazo explica que el resto queda para las respuestas', async () => {
    const cuenta = await crearCuenta(pool, { dailyCap: 5, minGapSeconds: 0 })
    const contactos = await Promise.all(Array.from({ length: 4 }, (_, i) => crearContacto(pool, i)))

    for (let i = 0; i < 2; i++) expect((await mandarConColchon(cuenta, contactos[i]!)).ok).toBe(true)
    const frenado = await mandarConColchon(cuenta, contactos[2]!)

    expect(frenado.ok).toBe(false)
    if (!frenado.ok) {
      expect(frenado.motivo).toBe('cupo')
      expect(frenado.detalle).toContain('Chatwoot')
    }
  })

  it('los salientes escritos a mano en Chatwoot consumen cupo', async () => {
    // Si no se contaran, mando 30 desde la consola más las respuestas a mano y
    // me paso del cupo sin enterarme.
    const cuenta = await crearCuenta(pool, { dailyCap: 5, minGapSeconds: 0 })
    const contacto = await crearContacto(pool)

    // Llega por webhook, ya enviado por Chatwoot: se registra directo.
    await pool.query(
      `insert into messages (contact_id, account_id, channel, direction, body, status,
                             send_mode, chatwoot_message_id, sent_at)
       values ($1, $2, 'whatsapp', 'out', 'te respondo', 'enviado', 'chatwoot_agente', 991, now())`,
      [contacto, cuenta],
    )
    expect(await contarCupo(pool, cuenta)).toBe(1)

    // Y la consola lo ve: solo le quedan 4.
    const contactos = await Promise.all(Array.from({ length: 6 }, (_, i) => crearContacto(pool, i)))
    const r = await Promise.all(contactos.map((c) => mandar(cuenta, c)))
    expect(r.filter((x) => x.ok)).toHaveLength(4)
    expect(await contarCupo(pool, cuenta)).toBe(5)
  }, 60_000)

  it('un colchón más grande que el cupo deja mandar igual al menos uno', async () => {
    // Los primeros días del calentamiento el cupo es 5: un colchón de 10 no
    // puede dejar el número mudo.
    const grande = opsConfigSchema.parse({ esperaMismaCuentaSeg: 0, colchonParaRespuestas: 10 })
    const cuenta = await crearCuenta(pool, { dailyCap: 5, minGapSeconds: 0 })
    const c = await crearContacto(pool)

    const r = await reservarYCrearMensaje(db, {
      accountId: cuenta,
      cfg: grande,
      ignorarVentana: true,
      mensaje: { contactId: c, channel: 'whatsapp', body: 'hola', sendMode: 'chatwoot' },
    })
    expect(r.ok).toBe(true)
  })

  it('el webhook de Chatwoot no puede insertar el mismo mensaje dos veces', async () => {
    const cuenta = await crearCuenta(pool, { dailyCap: 30, minGapSeconds: 0 })
    const contacto = await crearContacto(pool)

    const insertar = () =>
      pool.query(
        `insert into messages (contact_id, account_id, channel, direction, body, status,
                               send_mode, chatwoot_message_id, sent_at)
         values ($1, $2, 'whatsapp', 'out', 'hola', 'enviado', 'chatwoot_agente', 12345, now())`,
        [contacto, cuenta],
      )

    await insertar()
    await expect(insertar()).rejects.toMatchObject({ code: '23505' })
    expect(await contarCupo(pool, cuenta)).toBe(1)
  })
})

describe('claveIdempotente', () => {
  it('es la misma para el mismo contacto, paso y día', () => {
    expect(claveIdempotente('abc', 1, '2026-08-13')).toBe(claveIdempotente('abc', 1, '2026-08-13'))
  })

  it('cambia con el paso y con el día', () => {
    expect(claveIdempotente('abc', 1, '2026-08-13')).not.toBe(claveIdempotente('abc', 2, '2026-08-13'))
    expect(claveIdempotente('abc', 1, '2026-08-13')).not.toBe(claveIdempotente('abc', 1, '2026-08-14'))
  })
})

describe('elegirCuenta', () => {
  it('elige la menos usada hoy', async () => {
    const a = await crearCuenta(pool, { code: 'WA-A', dailyCap: 30, minGapSeconds: 0 })
    const b = await crearCuenta(pool, { code: 'WA-B', dailyCap: 30, minGapSeconds: 0 })

    for (let i = 0; i < 3; i++) await mandar(a, await crearContacto(pool, i))

    const elegida = await elegirCuenta(db, { channel: 'whatsapp', cfg })
    expect(elegida?.id).toBe(b)
  })

  it('a igualdad de uso, la que hace más tiempo que no envía', async () => {
    const a = await crearCuenta(pool, { code: 'WA-A2', dailyCap: 30, minGapSeconds: 0 })
    const b = await crearCuenta(pool, { code: 'WA-B2', dailyCap: 30, minGapSeconds: 0 })

    await mandar(a, await crearContacto(pool, 1), { ahora: new Date('2026-08-13T12:00:00Z') })
    await mandar(b, await crearContacto(pool, 2), { ahora: new Date('2026-08-13T14:00:00Z') })

    const elegida = await elegirCuenta(db, {
      channel: 'whatsapp',
      cfg,
      ahora: new Date('2026-08-13T15:00:00Z'),
    })
    expect(elegida?.id).toBe(a)
  })

  it('no elige cuentas que llegaron a su cupo', async () => {
    const a = await crearCuenta(pool, { code: 'WA-A3', dailyCap: 1, minGapSeconds: 0 })
    await mandar(a, await crearContacto(pool, 1))
    expect(await elegirCuenta(db, { channel: 'whatsapp', cfg })).toBeNull()
  })

  it('no elige cuentas pausadas ni bloqueadas', async () => {
    await crearCuenta(pool, { code: 'WA-P', status: 'pausada' })
    await crearCuenta(pool, { code: 'WA-X', status: 'bloqueada' })
    expect(await elegirCuenta(db, { channel: 'whatsapp', cfg })).toBeNull()
  })

  it('excluye la cuenta pedida para no mandar dos consecutivos iguales', async () => {
    const a = await crearCuenta(pool, { code: 'WA-A4', dailyCap: 30, minGapSeconds: 0 })
    const b = await crearCuenta(pool, { code: 'WA-B4', dailyCap: 30, minGapSeconds: 0 })

    const elegida = await elegirCuenta(db, { channel: 'whatsapp', cfg, excluir: [a] })
    expect(elegida?.id).toBe(b)
    void b
  })

  it('si excluir deja el conjunto vacío, prefiere repetir cuenta antes que no mandar', async () => {
    const a = await crearCuenta(pool, { code: 'WA-A5', dailyCap: 30, minGapSeconds: 0 })
    const elegida = await elegirCuenta(db, { channel: 'whatsapp', cfg, excluir: [a] })
    expect(elegida?.id).toBe(a)
  })

  it('no mezcla canales', async () => {
    await crearCuenta(pool, { code: 'IG-A', channel: 'instagram' })
    expect(await elegirCuenta(db, { channel: 'whatsapp', cfg })).toBeNull()
    expect((await elegirCuenta(db, { channel: 'instagram', cfg }))?.code).toBe('IG-A')
  })
})

describe('intercalarPorCuenta', () => {
  it('no deja dos consecutivos de la misma cuenta cuando hay con qué intercalar', () => {
    const items = [
      { id: 1, c: 'a' },
      { id: 2, c: 'a' },
      { id: 3, c: 'a' },
      { id: 4, c: 'b' },
      { id: 5, c: 'b' },
      { id: 6, c: 'c' },
    ]
    const r = intercalarPorCuenta(items, (x) => x.c)

    expect(r).toHaveLength(6)
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.c).not.toBe(r[i - 1]!.c)
    }
  })

  it('con una sola cuenta devuelve todo, porque mandar gana sobre alternar', () => {
    const items = [
      { id: 1, c: 'a' },
      { id: 2, c: 'a' },
      { id: 3, c: 'a' },
    ]
    const r = intercalarPorCuenta(items, (x) => x.c)
    expect(r.map((x) => x.id).sort()).toEqual([1, 2, 3])
  })

  it('no pierde ni duplica elementos', () => {
    const items = Array.from({ length: 97 }, (_, i) => ({ id: i, c: `c${i % 7}` }))
    const r = intercalarPorCuenta(items, (x) => x.c)
    expect(r).toHaveLength(97)
    expect(new Set(r.map((x) => x.id)).size).toBe(97)
  })

  it('preserva el orden de prioridad dentro de cada cuenta', () => {
    const items = [
      { id: 1, c: 'a' },
      { id: 2, c: 'b' },
      { id: 3, c: 'a' },
      { id: 4, c: 'b' },
    ]
    const r = intercalarPorCuenta(items, (x) => x.c)
    const soloA = r.filter((x) => x.c === 'a').map((x) => x.id)
    expect(soloA).toEqual([1, 3])
  })

  it('reparte parejo un caso desbalanceado sin amontonar al final', () => {
    // 8 de una cuenta y 2 de otra: es imposible alternar del todo, pero los
    // repetidos tienen que quedar distribuidos, no los 6 últimos juntos.
    const items = [
      ...Array.from({ length: 8 }, (_, i) => ({ id: i, c: 'a' })),
      ...Array.from({ length: 2 }, (_, i) => ({ id: 100 + i, c: 'b' })),
    ]
    const r = intercalarPorCuenta(items, (x) => x.c)
    expect(r).toHaveLength(10)
    const posiciones = r.map((x, i) => (x.c === 'b' ? i : -1)).filter((i) => i >= 0)
    // Las dos de 'b' no quedan pegadas al principio ni al final.
    expect(posiciones[0]).toBeGreaterThan(0)
    expect(posiciones[1]! - posiciones[0]!).toBeGreaterThan(1)
  })
})

describe('configuración operativa', () => {
  it('rechaza una escala de calentamiento vacía', () => {
    expect(opsConfigSchema.safeParse({ escalaCalentamiento: [] }).success).toBe(false)
  })

  it('acepta una escala más larga o más corta que 7 días', () => {
    const corta = opsConfigSchema.parse({ escalaCalentamiento: [3, 6, 10] })
    expect(corta.escalaCalentamiento).toHaveLength(3)
  })
})

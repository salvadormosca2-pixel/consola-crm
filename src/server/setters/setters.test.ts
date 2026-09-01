import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { PISTA_META } from '@/lib/pistas'
import type { PasoDeSeguimiento } from '@/lib/setters-config'
import {
  asignar,
  contarCupoDeSetter,
  crearDb,
  crearLeadScrapeado,
  crearPool,
  crearSetter,
  limpiar,
} from '@/test/db'

import { asignarLeads, barrer, contarPozo, devolverPendientes } from './asignacion'
import { leerPuertaDeEntrada } from './avisos'
import { agregarLeadPropio } from './leads'
import { borrarSetter, vaciarElEquipo } from './borrar'
import { deshacerEnvio, registrarEnvio } from './envios'
import { repartirAEsteSetter, repartirAhora, repartoAutomaticoDelDia } from './reparto'

/**
 * Las reglas que no se negocian, probadas contra Postgres de verdad.
 *
 * No son tests de mocks: lo que se está probando son los locks, el índice único
 * parcial y el recuento dentro de la transacción. Un mock no reproduce nada de
 * eso, y es justamente donde el sistema puede fallar de la peor manera —
 * quemando una cuenta de Instagram o mandándole dos mensajes al mismo negocio.
 */

let pool: Pool
let db: ReturnType<typeof crearDb>

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

function marcar(
  assignmentId: string,
  setterId: string,
  cuentaId: string,
  paso: PasoDeSeguimiento = 1,
) {
  return registrarEnvio(
    {
      assignmentId,
      setterId,
      cuentaId,
      paso,
      body: 'Hola! Vi tu perfil…',
      templateId: null,
      templateVariant: null,
      actorUserId: null,
    },
    db,
  )
}

describe('cupo por cuenta de Instagram', () => {
  it('nunca deja pasar de 30 en el día, aunque se marque de más', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!

    for (let i = 0; i < 32; i++) {
      const contacto = await crearLeadScrapeado(pool, i)
      const asignacion = await asignar(pool, contacto, setter.setterId)
      await marcar(asignacion, setter.setterId, cuenta)
    }

    expect(await contarCupoDeSetter(pool, cuenta)).toBe(30)
  })

  it('rechaza con el motivo escrito cuando la cuenta llegó al tope', async () => {
    const setter = await crearSetter(pool, { cupos: [2] })
    const cuenta = setter.cuentas[0]!

    for (let i = 0; i < 2; i++) {
      const c = await crearLeadScrapeado(pool, i)
      await marcar(await asignar(pool, c, setter.setterId), setter.setterId, cuenta)
    }

    const extra = await crearLeadScrapeado(pool, 99)
    const r = await marcar(await asignar(pool, extra, setter.setterId), setter.setterId, cuenta)

    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.motivo).toBe('cupo')
      expect(r.detalle).toContain('límite')
    }
  })

  it('aguanta 40 marcas simultáneas sobre una cuenta de 30', async () => {
    // Es el caso real de una app en el celular con la señal yendo y viniendo:
    // varias marcas salen juntas cuando vuelve la conexión.
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!

    const asignaciones: string[] = []
    for (let i = 0; i < 40; i++) {
      const c = await crearLeadScrapeado(pool, i)
      asignaciones.push(await asignar(pool, c, setter.setterId))
    }

    const resultados = await Promise.all(
      asignaciones.map((a) => marcar(a, setter.setterId, cuenta)),
    )

    expect(resultados.filter((r) => r.ok && !r.duplicado)).toHaveLength(30)
    expect(await contarCupoDeSetter(pool, cuenta)).toBe(30)
  })

  it('una segunda cuenta tiene su propio cupo', async () => {
    const setter = await crearSetter(pool, { cupos: [2, 2] })
    const [a, b] = setter.cuentas as [string, string]

    for (const cuenta of [a, b]) {
      for (let i = 0; i < 3; i++) {
        const c = await crearLeadScrapeado(pool, i)
        await marcar(await asignar(pool, c, setter.setterId), setter.setterId, cuenta)
      }
    }

    expect(await contarCupoDeSetter(pool, a)).toBe(2)
    expect(await contarCupoDeSetter(pool, b)).toBe(2)
  })
})

describe('idempotencia de la marca', () => {
  it('la misma marca repetida entra una sola vez y no consume cupo dos veces', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!
    const contacto = await crearLeadScrapeado(pool, 1)
    const asignacion = await asignar(pool, contacto, setter.setterId)

    const primera = await marcar(asignacion, setter.setterId, cuenta)
    const segunda = await marcar(asignacion, setter.setterId, cuenta)

    expect(primera.ok).toBe(true)
    expect(segunda.ok).toBe(true)
    if (segunda.ok) expect(segunda.duplicado).toBe(true)
    expect(await contarCupoDeSetter(pool, cuenta)).toBe(1)
  })

  it('tres reintentos simultáneos de la misma marca dejan un solo envío', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!
    const asignacion = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    await Promise.all([
      marcar(asignacion, setter.setterId, cuenta),
      marcar(asignacion, setter.setterId, cuenta),
      marcar(asignacion, setter.setterId, cuenta),
    ])

    expect(await contarCupoDeSetter(pool, cuenta)).toBe(1)
  })

  it('deshacer libera el cupo sin borrar el registro', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!
    const asignacion = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    const envio = await marcar(asignacion, setter.setterId, cuenta)
    expect(envio.ok && envio.sendId).toBeTruthy()

    const r = await deshacerEnvio(
      (envio as { sendId: string }).sendId,
      setter.setterId,
      null,
      db,
    )
    expect(r.ok).toBe(true)
    expect(await contarCupoDeSetter(pool, cuenta)).toBe(0)

    const filas = await pool.query('select undone_at from setter_sends')
    expect(filas.rows).toHaveLength(1)
    expect(filas.rows[0].undone_at).not.toBeNull()
  })
})

describe('el segundo mensaje', () => {
  it('queda programado al contactar y no antes', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const asignacion = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    const antes = await pool.query('select segundo_programado_at from lead_assignments')
    expect(antes.rows[0].segundo_programado_at).toBeNull()

    await marcar(asignacion, setter.setterId, setter.cuentas[0]!)

    const despues = await pool.query(
      'select estado, segundo_programado_at from lead_assignments',
    )
    expect(despues.rows[0].estado).toBe('contactado')
    expect(despues.rows[0].segundo_programado_at).not.toBeNull()
  })

  it('no se puede mandar a alguien que ya respondió', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const asignacion = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)
    await marcar(asignacion, setter.setterId, setter.cuentas[0]!)

    // El lead contesta: sale de la cola y se cancela el segundo mensaje.
    await pool.query(
      `update lead_assignments
          set estado = 'respondido', respondido_at = now(), segundo_programado_at = null,
              proximo_paso = null, proximo_seguimiento_at = null
        where id = $1`,
      [asignacion],
    )

    const r = await marcar(asignacion, setter.setterId, setter.cuentas[0]!, 2)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toBe('estado')
  })

  it('el segundo consume cupo igual que el primero', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!
    const asignacion = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    await marcar(asignacion, setter.setterId, cuenta)
    await pool.query(
      `update lead_assignments
          set segundo_programado_at = now() - interval '1 hour',
              proximo_paso = 2, proximo_seguimiento_at = now() - interval '1 hour'
        where id = $1`,
      [asignacion],
    )
    await marcar(asignacion, setter.setterId, cuenta, 2)

    expect(await contarCupoDeSetter(pool, cuenta)).toBe(2)
  })
})

describe('un lead, un solo setter', () => {
  it('dos setters pidiendo al mismo tiempo nunca se llevan el mismo negocio', async () => {
    const a = await crearSetter(pool, { cupos: [30] })
    const b = await crearSetter(pool, { cupos: [30] })
    for (let i = 0; i < 20; i++) await crearLeadScrapeado(pool, i)

    const [nA, nB] = await Promise.all([
      asignarLeads(a.setterId, 20, null, db),
      asignarLeads(b.setterId, 20, null, db),
    ])

    expect(nA + nB).toBe(20)

    const repetidos = await pool.query(
      `select contact_id from lead_assignments
        where estado not in ('vencido', 'devuelto')
        group by contact_id having count(*) > 1`,
    )
    expect(repetidos.rows).toHaveLength(0)
  })

  it('un lead ya tomado no vuelve a entregarse', async () => {
    const a = await crearSetter(pool, { cupos: [30] })
    const b = await crearSetter(pool, { cupos: [30] })
    await crearLeadScrapeado(pool, 1)

    expect(await asignarLeads(a.setterId, 5, null, db)).toBe(1)
    expect(await asignarLeads(b.setterId, 5, null, db)).toBe(0)
  })

  it('los clientes propios no entran al pozo de los setters', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    await pool.query(
      `insert into contacts (business_name, ig_username, has_instagram, origen, dedupe_key)
       values ('Cliente propio', 'cliente_propio', true, 'cliente', 'cliente_propio')`,
    )

    expect(await contarPozo(db)).toBe(0)
    expect(await asignarLeads(setter.setterId, 5, null, db)).toBe(0)
  })
})

describe('vencimiento y devolución', () => {
  it('un lead sin trabajar vuelve al pozo y se reasigna a otro', async () => {
    const a = await crearSetter(pool, { cupos: [30] })
    const b = await crearSetter(pool, { cupos: [30] })
    const contacto = await crearLeadScrapeado(pool, 1)

    // Asignado y vencido: es el setter que se cansó o dejó de trabajar.
    await asignar(pool, contacto, a.setterId, -1)

    const { vencidos } = await barrer(db)
    expect(vencidos).toBe(1)
    expect(await contarPozo(db)).toBe(1)
    expect(await asignarLeads(b.setterId, 5, null, db)).toBe(1)
  })

  it('un lead ya contactado NO vence: el segundo mensaje sigue siendo suyo', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const asignacion = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)
    await marcar(asignacion, setter.setterId, setter.cuentas[0]!)
    await pool.query(`update lead_assignments set vence_at = now() - interval '1 day'`)

    const { vencidos } = await barrer(db)
    expect(vencidos).toBe(0)
  })

  it('dar de baja devuelve los pendientes y deja intacto lo contactado', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })

    const contactado = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)
    await marcar(contactado, setter.setterId, setter.cuentas[0]!)
    await asignar(pool, await crearLeadScrapeado(pool, 2), setter.setterId)
    await asignar(pool, await crearLeadScrapeado(pool, 3), setter.setterId)

    const devueltos = await devolverPendientes(setter.setterId, 'baja', null, db)
    expect(devueltos).toBe(2)

    // El contactado conserva su asignación, que es la base de la comisión.
    const quedan = await pool.query(
      `select estado from lead_assignments where estado = 'contactado'`,
    )
    expect(quedan.rows).toHaveLength(1)

    const atribucion = await pool.query(
      `select setter_id from contacts where setter_id is not null`,
    )
    expect(atribucion.rows).toHaveLength(1)
  })

  it('el salteado de ayer vuelve a la cola, el de hoy no', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const ayer = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)
    const hoy = await asignar(pool, await crearLeadScrapeado(pool, 2), setter.setterId)

    await pool.query(
      `update lead_assignments
          set estado = 'saltado', pospuesto_at = now() - interval '2 days' where id = $1`,
      [ayer],
    )
    await pool.query(
      `update lead_assignments set estado = 'saltado', pospuesto_at = now() where id = $1`,
      [hoy],
    )

    const { desalteados } = await barrer(db)
    expect(desalteados).toBe(1)
  })
})

describe('la cuenta madre está protegida por la base', () => {
  it('no se puede degradar ni borrar, ni siquiera con una consulta suelta', async () => {
    await pool.query(
      `insert into users (email, name, password_hash, role)
       values ('madre@test.local', 'Madre', 'x', 'admin_madre')`,
    )

    await expect(
      pool.query(`update users set role = 'setter' where role = 'admin_madre'`),
    ).rejects.toThrow(/admin madre/i)

    await expect(
      pool.query(`update users set status = 'baja' where role = 'admin_madre'`),
    ).rejects.toThrow(/admin madre/i)

    await expect(pool.query(`delete from users where role = 'admin_madre'`)).rejects.toThrow(
      /admin madre/i,
    )
  })

  it('no puede haber dos cuentas madre', async () => {
    await pool.query(
      `insert into users (email, name, password_hash, role)
       values ('madre@test.local', 'Madre', 'x', 'admin_madre')`,
    )
    await expect(
      pool.query(
        `insert into users (email, name, password_hash, role)
         values ('otra@test.local', 'Otra', 'x', 'admin_madre')`,
      ),
    ).rejects.toThrow()
  })
})

describe('reparto de una lista grande', () => {
  it('mil leads entre tres setters: ninguno repetido y nadie se pasa de su cupo', async () => {
    const a = await crearSetter(pool, { cupos: [30, 30], tanda: 60 })
    const b = await crearSetter(pool, { cupos: [30], tanda: 30 })
    const c = await crearSetter(pool, { cupos: [30, 30], tanda: 60 })

    for (let i = 0; i < 1000; i++) await crearLeadScrapeado(pool, i)

    const r = await repartirAhora(null, db)

    // 60 + 30 + 60 de capacidad: se entregan 150 y el resto queda en el pozo.
    expect(r.entregados).toBe(150)
    expect(await contarPozo(db)).toBe(850)

    const repetidos = await pool.query(
      `select contact_id from lead_assignments
        where estado not in ('vencido', 'devuelto')
        group by contact_id having count(*) > 1`,
    )
    expect(repetidos.rows).toHaveLength(0)

    for (const setter of [a, b, c]) {
      const n = await pool.query<{ n: string }>(
        `select count(*) as n from lead_assignments where setter_id = $1`,
        [setter.setterId],
      )
      const tope = setter.cuentas.length * 30
      expect(Number(n.rows[0]!.n)).toBeLessThanOrEqual(tope)
    }
  })

  it('repartir dos veces seguidas no entrega nada la segunda vez', async () => {
    await crearSetter(pool, { cupos: [30], tanda: 30 })
    for (let i = 0; i < 100; i++) await crearLeadScrapeado(pool, i)

    expect((await repartirAhora(null, db)).entregados).toBe(30)
    // Ya tiene su tanda entera sin contactar: no hay lugar para más.
    expect((await repartirAhora(null, db)).entregados).toBe(0)
  })

  it('un reparto y un setter pidiendo leads a la vez no se llevan el mismo', async () => {
    const a = await crearSetter(pool, { cupos: [30], tanda: 30 })
    const b = await crearSetter(pool, { cupos: [30], tanda: 30 })
    for (let i = 0; i < 40; i++) await crearLeadScrapeado(pool, i)

    await Promise.all([repartirAhora(null, db), asignarLeads(b.setterId, 30, null, db)])

    const repetidos = await pool.query(
      `select contact_id from lead_assignments
        where estado not in ('vencido', 'devuelto')
        group by contact_id having count(*) > 1`,
    )
    expect(repetidos.rows).toHaveLength(0)

    const total = await pool.query<{ n: string }>(
      `select count(*) as n from lead_assignments where estado not in ('vencido','devuelto')`,
    )
    // Nunca más leads asignados que los que existen en el pozo.
    expect(Number(total.rows[0]!.n)).toBeLessThanOrEqual(40)
    expect(a.setterId).not.toBe(b.setterId)
  })

  it('los leads ya asignados no se vuelven a repartir', async () => {
    const a = await crearSetter(pool, { cupos: [30], tanda: 30 })
    for (let i = 0; i < 10; i++) await crearLeadScrapeado(pool, i)

    await asignarLeads(a.setterId, 10, null, db)
    expect(await contarPozo(db)).toBe(0)

    await crearSetter(pool, { cupos: [30], tanda: 30 })
    expect((await repartirAhora(null, db)).entregados).toBe(0)
  })
})

describe('el reparto automático del día', () => {
  /**
   * La hora se baja a las 00:00 para que el test no dependa de a qué hora corra
   * el CI. `settings` no entra en el truncate entre tests, así que se borra a
   * mano al terminar.
   */
  async function repartoAutomaticoDesdeLasCero(): Promise<void> {
    await pool.query(
      `insert into settings (key, value_jsonb) values ('setters', $1)
       on conflict (key) do update set value_jsonb = excluded.value_jsonb`,
      [JSON.stringify({ repartoAutomatico: true, horaReparto: '00:00' })],
    )
  }

  async function olvidarConfig(): Promise<void> {
    await pool.query(`delete from settings where key = 'setters'`)
  }

  it('sale una sola vez por día, aunque dos pantallas lo pidan a la vez', async () => {
    await repartoAutomaticoDesdeLasCero()
    try {
      await crearSetter(pool, { cupos: [30], tanda: 30 })
      for (let i = 0; i < 100; i++) await crearLeadScrapeado(pool, i)

      // Dos setters abriendo la app en el mismo segundo. El índice único de la
      // marca del día deja pasar a uno solo: sin él, los dos repartirían.
      const [uno, otro] = await Promise.all([
        repartoAutomaticoDelDia(db),
        repartoAutomaticoDelDia(db),
      ])
      expect(uno + otro).toBe(30)
      expect(Math.min(uno, otro)).toBe(0)

      // Y ya no vuelve a salir hoy, ni aunque quede cupo libre.
      expect(await repartoAutomaticoDelDia(db)).toBe(0)
      expect(await contarPozo(db)).toBe(70)
    } finally {
      await olvidarConfig()
    }
  })

  it('apagado en la configuración, no reparte nada', async () => {
    await pool.query(
      `insert into settings (key, value_jsonb) values ('setters', $1)
       on conflict (key) do update set value_jsonb = excluded.value_jsonb`,
      [JSON.stringify({ repartoAutomatico: false, horaReparto: '00:00' })],
    )
    try {
      await crearSetter(pool, { cupos: [30], tanda: 30 })
      for (let i = 0; i < 50; i++) await crearLeadScrapeado(pool, i)

      expect(await repartoAutomaticoDelDia(db)).toBe(0)
      expect(await contarPozo(db)).toBe(50)
    } finally {
      await olvidarConfig()
    }
  })

  it('un setter sin cuenta de Instagram no recibe nada', async () => {
    await repartoAutomaticoDesdeLasCero()
    try {
      // Recién dado de alta en lote: existe, puede entrar, no tiene cuenta.
      const sinCuenta = await crearSetter(pool, { cupos: [], tanda: 30 })
      for (let i = 0; i < 50; i++) await crearLeadScrapeado(pool, i)

      expect(await repartoAutomaticoDelDia(db)).toBe(0)

      const suyos = await pool.query<{ n: string }>(
        `select count(*) as n from lead_assignments where setter_id = $1`,
        [sinCuenta.setterId],
      )
      expect(Number(suyos.rows[0]!.n)).toBe(0)
      // Los leads siguen en el pozo, disponibles para el que sí pueda mandar.
      expect(await contarPozo(db)).toBe(50)
    } finally {
      await olvidarConfig()
    }
  })
})

describe('las pistas: por dónde sigue el que no contesta', () => {
  /** Deja el seguimiento del lead vencido, para que aparezca en la cola. */
  async function adelantarReloj(assignmentId: string): Promise<void> {
    await pool.query(
      `update lead_assignments set proximo_seguimiento_at = now() - interval '1 hour'
        where id = $1`,
      [assignmentId],
    )
  }

  async function leerPaso(assignmentId: string): Promise<number | null> {
    const r = await pool.query<{ proximo_paso: number | null }>(
      'select proximo_paso from lead_assignments where id = $1',
      [assignmentId],
    )
    return r.rows[0]?.proximo_paso ?? null
  }

  /** Manda una escalera entera y devuelve el paso en el que quedó. */
  async function bajarEscalera(
    a: string,
    setterId: string,
    cuenta: string,
    pasos: readonly PasoDeSeguimiento[],
  ): Promise<number | null> {
    for (const paso of pasos) {
      await adelantarReloj(a)
      await marcar(a, setterId, cuenta, paso)
    }
    return leerPaso(a)
  }

  const REINTENTO = PISTA_META.sin_abrir.pasos.map((p) => p.paso)
  const SILENCIO = PISTA_META.silencio.pasos.map((p) => p.paso)

  it('el que nunca contestó la entrada no ve la oferta: va al reintento', async () => {
    // Es el cambio de fondo. Antes la oferta salía igual a las horas, a alguien
    // que jamás abrió el chat.
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!
    const a = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    await marcar(a, setter.setterId, cuenta, 1)
    expect(await leerPaso(a)).toBe(REINTENTO[0])
  })

  it('el reintento son dos intentos y ahí se corta', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!
    const a = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    await marcar(a, setter.setterId, cuenta, 1)
    // Después del segundo no se insiste más: cada intento de más es cupo
    // gastado y riesgo para la cuenta.
    expect(await bajarEscalera(a, setter.setterId, cuenta, REINTENTO)).toBeNull()
  })

  it('mandada la oferta sin respuesta, baja los cuatro escalones de silencio', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!
    const a = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    await marcar(a, setter.setterId, cuenta, 1)
    await adelantarReloj(a)
    await marcar(a, setter.setterId, cuenta, 2)
    expect(await leerPaso(a)).toBe(SILENCIO[0])

    // Un seguimiento no es un mensaje: es una escalera, y se recorre entera.
    expect(await bajarEscalera(a, setter.setterId, cuenta, SILENCIO)).toBeNull()
  })

  it('cada mensaje entra una sola vez aunque se marque dos veces', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!
    const a = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    await marcar(a, setter.setterId, cuenta, 1)
    await adelantarReloj(a)
    await marcar(a, setter.setterId, cuenta, REINTENTO[0]!)
    await marcar(a, setter.setterId, cuenta, REINTENTO[0]!)

    expect(await contarCupoDeSetter(pool, cuenta)).toBe(2)
  })

  it('los seguimientos no gastan cupo: el chat ya está abierto', async () => {
    /*
     * Lo que hace que Instagram restrinja una cuenta es abrir chats nuevos con
     * desconocidos, no seguir uno empezado. Si los seguimientos gastaran cupo,
     * trabajar bien a los que ya contestaron competiría con abrir leads nuevos,
     * que son dos cosas que no tienen por qué disputarse el mismo número.
     */
    const setter = await crearSetter(pool, { cupos: [3] })
    const cuenta = setter.cuentas[0]!
    const a = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    await marcar(a, setter.setterId, cuenta, 1)
    await adelantarReloj(a)
    await marcar(a, setter.setterId, cuenta, 2)
    await bajarEscalera(a, setter.setterId, cuenta, SILENCIO)

    // Seis envíos salieron por esa cuenta…
    expect(await contarCupoDeSetter(pool, cuenta)).toBe(6)

    // …pero de cupo solo gastaron los dos que abren: la entrada y la oferta.
    // Por eso todavía entra una apertura más de las tres del día.
    const otro = await asignar(pool, await crearLeadScrapeado(pool, 2), setter.setterId)
    expect((await marcar(otro, setter.setterId, cuenta, 1)).ok).toBe(true)

    // Esa fue la tercera: la siguiente apertura ya rebota.
    const tercero = await asignar(pool, await crearLeadScrapeado(pool, 3), setter.setterId)
    expect((await marcar(tercero, setter.setterId, cuenta, 1)).ok).toBe(false)
  })

  it('el reintento sí gasta cupo, porque el chat nunca se abrió', async () => {
    const setter = await crearSetter(pool, { cupos: [1] })
    const cuenta = setter.cuentas[0]!
    const a = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    await marcar(a, setter.setterId, cuenta, 1)
    await adelantarReloj(a)

    // La entrada ya consumió el único cupo del día.
    expect((await marcar(a, setter.setterId, cuenta, REINTENTO[0]!)).ok).toBe(false)
  })

  it('deshacer un escalón lo deja pendiente otra vez', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!
    const a = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    await marcar(a, setter.setterId, cuenta, 1)
    await adelantarReloj(a)
    await marcar(a, setter.setterId, cuenta, 2)
    await adelantarReloj(a)
    const envio = await marcar(a, setter.setterId, cuenta, SILENCIO[0]!)

    expect(await leerPaso(a)).toBe(SILENCIO[1])

    await deshacerEnvio((envio as { sendId: string }).sendId, setter.setterId, null, db)

    // Si se marcó sin querer, el lead no puede perder ese escalón.
    expect(await leerPaso(a)).toBe(SILENCIO[0])
  })
})

describe('lo que le llega al admin y lo que le llega al setter', () => {
  /** Un anuncio del equipo, como lo deja la pantalla de avisos del admin. */
  async function crearAviso(
    autorUserId: string,
    opts: { fijado?: boolean; nivel?: string; destinatarios?: string[] } = {},
  ): Promise<string> {
    const m = await pool.query<{ id: string }>(
      `insert into mensajes_equipo (autor_admin, nivel, titulo, cuerpo, fijado)
       values ($1, $2, 'Cambió el guion', 'No uses el mensaje anterior.', $3)
       returning id`,
      [autorUserId, opts.nivel ?? 'aviso', opts.fijado ?? false],
    )
    const id = m.rows[0]!.id
    for (const setterId of opts.destinatarios ?? []) {
      await pool.query(
        `insert into mensajes_destinatarios (mensaje_id, setter_id) values ($1, $2)
         on conflict do nothing`,
        [id, setterId],
      )
    }
    return id
  }

  async function contarEventos(tipo: string): Promise<number> {
    const r = await pool.query<{ n: string }>(
      'select count(*) as n from events where type = $1',
      [tipo],
    )
    return Number(r.rows[0]?.n ?? 0)
  }

  it('un anuncio fijado le llega también al que entró después', async () => {
    /*
     * Un aviso común es un momento; uno fijado es una regla que queda. Los
     * destinatarios se congelaban al mandarlo, así que el que entraba la semana
     * siguiente no veía ninguna regla vigente — y para el admin figuraba
     * "leído por todos", porque el nuevo nunca fue de los destinatarios.
     */
    const viejo = await crearSetter(pool, { cupos: [30] })
    await crearAviso(viejo.userId, { fijado: true, destinatarios: [viejo.setterId] })

    const nuevo = await crearSetter(pool, { cupos: [30] })
    const puerta = await leerPuertaDeEntrada(nuevo.setterId, db)

    expect(puerta.fijados).toHaveLength(1)
    expect(puerta.fijados[0]!.titulo).toBe('Cambió el guion')
  })

  it('un aviso común no le reaparece al que entró después', async () => {
    const viejo = await crearSetter(pool, { cupos: [30] })
    await crearAviso(viejo.userId, { fijado: false, destinatarios: [viejo.setterId] })

    const nuevo = await crearSetter(pool, { cupos: [30] })
    const puerta = await leerPuertaDeEntrada(nuevo.setterId, db)

    expect(puerta.fijados).toHaveLength(0)
    expect(puerta.sinLeer).toBe(0)
  })

  it('completar los fijados es idempotente: no duplica ni marca como no leído', async () => {
    const admin = await crearSetter(pool, { cupos: [30] })
    await crearAviso(admin.userId, { fijado: true })

    const nuevo = await crearSetter(pool, { cupos: [30] })
    await leerPuertaDeEntrada(nuevo.setterId, db)
    await leerPuertaDeEntrada(nuevo.setterId, db)

    const r = await pool.query<{ n: string }>(
      'select count(*) as n from mensajes_destinatarios where setter_id = $1',
      [nuevo.setterId],
    )
    expect(Number(r.rows[0]!.n)).toBe(1)
  })

  it('un lead que vence deja su línea en la bitácora', async () => {
    /*
     * Es lo único que le pasa a un lead sin que lo decida nadie: lo mueve el
     * reloj. Sin registro, un negocio podía pasar por tres setters sin que
     * quedara escrito por qué.
     */
    const setter = await crearSetter(pool, { cupos: [30] })
    const a = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)
    await pool.query(`update lead_assignments set vence_at = now() - interval '1 hour' where id = $1`, [a])

    const antes = await contarEventos('lead_vencido')
    const r = await barrer(db)

    expect(r.vencidos).toBe(1)
    expect(await contarEventos('lead_vencido')).toBe(antes + 1)
  })

  it('barrer dos veces no vence ni registra de nuevo', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const a = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)
    await pool.query(`update lead_assignments set vence_at = now() - interval '1 hour' where id = $1`, [a])

    await barrer(db)
    const despues = await contarEventos('lead_vencido')
    const segunda = await barrer(db)

    expect(segunda.vencidos).toBe(0)
    expect(await contarEventos('lead_vencido')).toBe(despues)
  })

  it('sin nada vencido, barrer no escribe nada y no rompe', async () => {
    // Corre en cada carga de la cola y del tablero: el camino vacío es el que
    // más se ejecuta y el que no puede fallar.
    const setter = await crearSetter(pool, { cupos: [30] })
    await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    const r = await barrer(db)
    expect(r.vencidos).toBe(0)
    expect(await contarEventos('lead_vencido')).toBe(0)
  })
})

describe('un setter no puede tocar el lead de otro', () => {
  /**
   * Es la regla que sostiene todo lo demás. Si dos setters pudieran trabajar el
   * mismo negocio, el lead recibiría dos conversaciones distintas desde dos
   * cuentas distintas, y ninguna de las dos serviría.
   *
   * No alcanza con esconder el botón: el servidor vuelve a preguntar de quién
   * es el lead en cada envío.
   */
  it('el envío rebota si el lead es de otro', async () => {
    const a = await crearSetter(pool, { cupos: [30] })
    const b = await crearSetter(pool, { cupos: [30] })
    const suyo = await asignar(pool, await crearLeadScrapeado(pool, 1), a.setterId)

    // B intenta mandarle al lead de A, con su propia cuenta.
    const r = await marcar(suyo, b.setterId, b.cuentas[0]!, 1)

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toBe('estado')
    expect(await contarCupoDeSetter(pool, b.cuentas[0]!)).toBe(0)
  })

  it('tampoco puede seguir una conversación ajena', async () => {
    const a = await crearSetter(pool, { cupos: [30] })
    const b = await crearSetter(pool, { cupos: [30] })
    const suyo = await asignar(pool, await crearLeadScrapeado(pool, 1), a.setterId)

    await marcar(suyo, a.setterId, a.cuentas[0]!, 1)
    await pool.query(
      `update lead_assignments set proximo_seguimiento_at = now() - interval '1 hour'
        where id = $1`,
      [suyo],
    )

    const r = await marcar(suyo, b.setterId, b.cuentas[0]!, 2)
    expect(r.ok).toBe(false)

    // El envío de A sigue siendo el único, y desde su cuenta.
    expect(await contarCupoDeSetter(pool, a.cuentas[0]!)).toBe(1)
    expect(await contarCupoDeSetter(pool, b.cuentas[0]!)).toBe(0)
  })
})

describe('el seguimiento sale de la cuenta que abrió la conversación', () => {
  /**
   * En Instagram el hilo vive en la cuenta que escribió primero. Un seguimiento
   * desde otra cuenta no es un seguimiento: es escribirle de cero a alguien que
   * ya te conoce, desde un desconocido.
   *
   * La asignación guarda con qué cuenta se contactó, y eso es lo que decide de
   * dónde sale todo lo que venga después.
   */
  it('la asignación se queda con la cuenta del primer mensaje', async () => {
    const setter = await crearSetter(pool, { cupos: [30, 30] })
    const [primera, segunda] = setter.cuentas
    const a = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    await marcar(a, setter.setterId, primera!, 1)

    const fila = await pool.query<{ setter_account_id: string }>(
      'select setter_account_id from lead_assignments where id = $1',
      [a],
    )
    expect(fila.rows[0]?.setter_account_id).toBe(primera)
    expect(fila.rows[0]?.setter_account_id).not.toBe(segunda)
  })

  it('el cupo de cada cuenta se cuenta por separado', async () => {
    const setter = await crearSetter(pool, { cupos: [30, 30] })
    const [primera, segunda] = setter.cuentas
    const a = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    await marcar(a, setter.setterId, primera!, 1)
    await pool.query(
      `update lead_assignments set proximo_seguimiento_at = now() - interval '1 hour'
        where id = $1`,
      [a],
    )
    await marcar(a, setter.setterId, primera!, 2)

    // Los dos mensajes salieron de la primera: la segunda sigue intacta.
    expect(await contarCupoDeSetter(pool, primera!)).toBe(2)
    expect(await contarCupoDeSetter(pool, segunda!)).toBe(0)
  })
})

describe('contestó la entrada: le toca la oferta', () => {
  /**
   * El camino bueno del módulo. El lead contesta el mensaje de entrada, y ahí
   * recién se entera de a qué nos dedicamos: lo que sigue es la oferta, y va
   * enseguida, no dentro de tres días. Estos tests fijan que la oferta se
   * pueda mandar sobre un lead que ya respondió — antes el estado 'respondido'
   * la bloqueaba y el lead se quedaba sin el mensaje que importa.
   */
  async function contestaLaEntrada(assignmentId: string): Promise<void> {
    await pool.query(
      `update lead_assignments
          set estado = 'respondido', respondido_at = now(), segundo_programado_at = null,
              respondio_a = 'primero', proximo_paso = 2, proximo_seguimiento_at = now()
        where id = $1`,
      [assignmentId],
    )
  }

  async function leerLead(assignmentId: string) {
    const r = await pool.query<{
      estado: string
      respondio_a: string | null
      proximo_paso: number | null
      proximo_seguimiento_at: Date | null
    }>(
      `select estado, respondio_a, proximo_paso, proximo_seguimiento_at
         from lead_assignments where id = $1`,
      [assignmentId],
    )
    return r.rows[0]!
  }

  it('la oferta sale sobre un lead que ya respondió', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!
    const a = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    await marcar(a, setter.setterId, cuenta, 1)
    await contestaLaEntrada(a)

    const r = await marcar(a, setter.setterId, cuenta, 2)
    expect(r.ok).toBe(true)

    const lead = await leerLead(a)
    expect(lead.estado).toBe('segundo_enviado')
    // Contestó la entrada y eso no se pierde: sigue siendo lo que lo distingue
    // de alguien que nunca dijo nada.
    expect(lead.respondio_a).toBe('primero')
    expect(await contarCupoDeSetter(pool, cuenta)).toBe(2)
  })

  it('haber contestado la entrada no lo salva de silencio si se calla en la oferta', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!
    const a = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    await marcar(a, setter.setterId, cuenta, 1)
    await contestaLaEntrada(a)
    await marcar(a, setter.setterId, cuenta, 2)

    /*
     * Ya había hablado una vez, pero ante la oferta se calló igual, y el que se
     * calla ante la oferta entra a silencio. Sin esto se caía del sistema: no
     * entraba a ninguna pista y no volvía a recibir nada.
     */
    expect((await leerLead(a)).proximo_paso).toBe(PISTA_META.silencio.pasos[0]!.paso)
  })

  it('al que nunca contestó le sigue tocando el último intento', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!
    const a = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    await marcar(a, setter.setterId, cuenta, 1)
    await pool.query(
      `update lead_assignments set proximo_seguimiento_at = now() - interval '1 hour'
        where id = $1`,
      [a],
    )
    await marcar(a, setter.setterId, cuenta, 2)

    expect((await leerLead(a)).proximo_paso).toBe(3)
  })

  it('deshacer la oferta la deja pendiente ya mismo, no dentro de un día', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!
    const a = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    await marcar(a, setter.setterId, cuenta, 1)
    await contestaLaEntrada(a)
    const envio = await marcar(a, setter.setterId, cuenta, 2)

    await deshacerEnvio((envio as { sendId: string }).sendId, setter.setterId, null, db)

    const lead = await leerLead(a)
    // Vuelve a "respondió", no a "contactado": la respuesta pasó de verdad.
    expect(lead.estado).toBe('respondido')
    expect(lead.proximo_paso).toBe(2)
    expect(lead.proximo_seguimiento_at!.getTime()).toBeLessThanOrEqual(Date.now())
    expect(await contarCupoDeSetter(pool, cuenta)).toBe(1)
  })
})

describe('las situaciones que marca el setter', () => {
  /**
   * Las cuatro que se agregaron después de las cinco originales. Antes, tres de
   * ellas no mandaban nada: el "le interesa" esperaba a enfriarse cinco días
   * para recién ahí escribirle, el "no me interesa" se cerraba en silencio y
   * una reunión quedaba de palabra. Estos tests fijan que ahora cada marca del
   * setter tenga su propio mensaje, y que ninguna rama insista de más.
   */
  async function dejarPendiente(assignmentId: string, paso: number): Promise<void> {
    await pool.query(
      `update lead_assignments
          set proximo_paso = $2, proximo_seguimiento_at = now() - interval '1 hour'
        where id = $1`,
      [assignmentId, paso],
    )
  }

  async function leerPaso(assignmentId: string): Promise<number | null> {
    const r = await pool.query<{ proximo_paso: number | null }>(
      'select proximo_paso from lead_assignments where id = $1',
      [assignmentId],
    )
    return r.rows[0]?.proximo_paso ?? null
  }

  /** Un lead que contestó la entrada y ya recibió la oferta. */
  async function hastaLaOferta(setterId: string, cuenta: string): Promise<string> {
    const a = await asignar(pool, await crearLeadScrapeado(pool, 1), setterId)
    await marcar(a, setterId, cuenta, 1)
    await pool.query(
      `update lead_assignments
          set estado = 'respondido', respondido_at = now(), segundo_programado_at = null,
              respondio_a = 'primero', proximo_paso = 2, proximo_seguimiento_at = now()
        where id = $1`,
      [a],
    )
    await marcar(a, setterId, cuenta, 2)
    return a
  }

  it('la escalera de silencio se recorre entera y ahí se corta', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!
    const a = await hastaLaOferta(setter.setterId, cuenta)

    const escalones = PISTA_META.silencio.pasos.map((x) => x.paso)
    expect(await leerPaso(a)).toBe(escalones[0])

    for (const paso of escalones) {
      await dejarPendiente(a, paso)
      await marcar(a, setter.setterId, cuenta, paso)
    }

    // Se acabó: después del último no le sigue nada y queda para nurture.
    expect(await leerPaso(a)).toBeNull()
  })

  it('mandado el "le interesa", la cadena no le engancha nada más', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!
    const a = await hastaLaOferta(setter.setterId, cuenta)

    await dejarPendiente(a, 6)
    const r = await marcar(a, setter.setterId, cuenta, 6)
    expect(r.ok).toBe(true)

    /*
     * Dijo que sí: lo que sigue es una reunión, no otro mensaje automático. Si
     * después se enfría, quien lo mete en la pista de tibio es una persona
     * desde la cola de clasificación — insistirle solo por reloj a alguien que
     * ya dijo que sí es la forma de que deje de decir que sí.
     */
    expect(await leerPaso(a)).toBeNull()
  })

  it('un no se respeta: el cierre sale una vez y no encadena nada', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!
    const a = await hastaLaOferta(setter.setterId, cuenta)

    await dejarPendiente(a, 7)
    await marcar(a, setter.setterId, cuenta, 7)
    expect(await leerPaso(a)).toBeNull()
  })

  it('la confirmación de la reunión sale una vez y no encadena nada', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!
    const a = await hastaLaOferta(setter.setterId, cuenta)

    await dejarPendiente(a, 8)
    await marcar(a, setter.setterId, cuenta, 8)
    expect(await leerPaso(a)).toBeNull()
  })

  it('con el cupo agotado el seguimiento sale igual, y la apertura no', async () => {
    const setter = await crearSetter(pool, { cupos: [2] })
    const cuenta = setter.cuentas[0]!
    const a = await hastaLaOferta(setter.setterId, cuenta)

    // La entrada y la oferta ya gastaron las dos del cupo del día.
    const otro = await asignar(pool, await crearLeadScrapeado(pool, 2), setter.setterId)
    expect((await marcar(otro, setter.setterId, cuenta, 1)).ok).toBe(false)

    /*
     * Pero el seguimiento sale igual: ese chat ya está abierto. Si el cupo lo
     * frenara, el lead que contestó quedaría sin respuesta por culpa del
     * presupuesto de abrir desconocidos, que es justo al revés de lo que
     * conviene.
     */
    const escalon = PISTA_META.silencio.pasos[0]!.paso
    await dejarPendiente(a, escalon)
    expect((await marcar(a, setter.setterId, cuenta, escalon)).ok).toBe(true)
  })
})

describe('el candado de "primero abrí el chat"', () => {
  /**
   * `abierto_at` es "se abrió desde el último envío", no "se abrió alguna vez".
   *
   * Sellarlo una sola vez dejaba el botón "Enviado" habilitado de entrada en
   * todos los seguimientos: el candado servía solo en la entrada, que es donde
   * menos falta hace. En un seguimiento el pulgar ya conoce la pantalla.
   */
  async function leerAbierto(assignmentId: string): Promise<Date | null> {
    const r = await pool.query<{ abierto_at: Date | null }>(
      'select abierto_at from lead_assignments where id = $1',
      [assignmentId],
    )
    return r.rows[0]?.abierto_at ?? null
  }

  async function abrir(assignmentId: string): Promise<void> {
    await pool.query('update lead_assignments set abierto_at = now() where id = $1', [
      assignmentId,
    ])
  }

  it('cada envío rearma el candado', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const cuenta = setter.cuentas[0]!
    const a = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)

    await abrir(a)
    await marcar(a, setter.setterId, cuenta, 1)
    // Mandada la entrada, para la oferta hay que volver a abrir el chat.
    expect(await leerAbierto(a)).toBeNull()

    await pool.query(
      `update lead_assignments set proximo_seguimiento_at = now() - interval '1 hour'
        where id = $1`,
      [a],
    )
    await abrir(a)
    await marcar(a, setter.setterId, cuenta, 2)
    expect(await leerAbierto(a)).toBeNull()
  })
})

/**
 * Borrar y dar de baja no son lo mismo, y la diferencia la decide la base de
 * datos, no el botón: en cuanto hay un mensaje mandado, borrar deja de estar
 * disponible. Es lo único que separa "me equivoqué al dar de alta" de "perdí la
 * comisión de un mes".
 */
describe('borrar un alta equivocada', () => {
  it('borra al que nunca trabajó y le devuelve los leads al pozo', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)
    expect(await contarPozo(db)).toBe(0)

    const r = await borrarSetter(setter.setterId, null, db)
    expect(r.ok).toBe(true)

    const usuario = await pool.query('select 1 from users where id = $1', [setter.userId])
    expect(usuario.rows).toHaveLength(0)

    // La ficha y las cuentas de Instagram se van con él, y el lead que tenía
    // tomado y no tocó vuelve a estar disponible para el próximo reparto.
    const ficha = await pool.query('select 1 from setters where id = $1', [setter.setterId])
    expect(ficha.rows).toHaveLength(0)
    const cuentas = await pool.query('select 1 from setter_accounts where setter_id = $1', [
      setter.setterId,
    ])
    expect(cuentas.rows).toHaveLength(0)
    expect(await contarPozo(db)).toBe(1)

    // Queda escrito quién lo borró: una cuenta no puede desaparecer sin rastro.
    const evento = await pool.query(
      `select payload_jsonb from events where type = 'setter_eliminado'`,
    )
    expect(evento.rows).toHaveLength(1)
  })

  it('no borra al que ya mandó un mensaje: ahí la respuesta es dar de baja', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const asignacion = await asignar(pool, await crearLeadScrapeado(pool, 1), setter.setterId)
    await marcar(asignacion, setter.setterId, setter.cuentas[0]!)

    const r = await borrarSetter(setter.setterId, null, db)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/baja/i)

    const usuario = await pool.query('select 1 from users where id = $1', [setter.userId])
    expect(usuario.rows).toHaveLength(1)
  })

  it('tampoco borra a un admin, aunque se pida por su ficha', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    await pool.query(`update users set role = 'admin' where id = $1`, [setter.userId])

    const r = await borrarSetter(setter.setterId, null, db)
    expect(r.ok).toBe(false)

    const usuario = await pool.query('select 1 from users where id = $1', [setter.userId])
    expect(usuario.rows).toHaveLength(1)
  })
})

/**
 * Vaciar el equipo es la operación más destructiva que tiene la consola, y lo
 * que hay que probar no es que borre —eso es fácil— sino los dos límites: que
 * no se lleve puestas las cuentas de admin, y que el lead que ya contestó no
 * vuelva a la ruleta como si fuera frío.
 */
describe('vaciar el equipo', () => {
  it('borra todas las cuentas de setter y devuelve los leads al pozo', async () => {
    const a = await crearSetter(pool, { cupos: [30] })
    const b = await crearSetter(pool, { cupos: [30] })

    const contactado = await asignar(pool, await crearLeadScrapeado(pool, 1), a.setterId)
    await marcar(contactado, a.setterId, a.cuentas[0]!)
    await asignar(pool, await crearLeadScrapeado(pool, 2), b.setterId)
    expect(await contarPozo(db)).toBe(0)

    const r = await vaciarElEquipo(null, db)
    expect(r.setters).toBe(2)
    expect(r.alPozo).toBe(2)

    for (const tabla of ['setters', 'setter_accounts', 'setter_sends', 'lead_assignments']) {
      const filas = await pool.query(`select 1 from ${tabla}`)
      expect(filas.rows, tabla).toHaveLength(0)
    }
    const cuentas = await pool.query(`select 1 from users where role = 'setter'`)
    expect(cuentas.rows).toHaveLength(0)

    // Los dos vuelven, incluido el que ya tenía un mensaje mandado: nadie
    // contestó, así que siguen siendo leads fríos sin dueño.
    expect(await contarPozo(db)).toBe(2)
    const limpio = await pool.query(
      `select stage, setter_id, sent_count, sequence_step from contacts`,
    )
    for (const fila of limpio.rows) {
      expect(fila).toMatchObject({ stage: 'nuevo', setter_id: null, sent_count: 0 })
    }
  })

  it('el que ya contestó no vuelve al pozo ni pierde su ficha', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const contactId = await crearLeadScrapeado(pool, 1)
    const asignacion = await asignar(pool, contactId, setter.setterId)
    await marcar(asignacion, setter.setterId, setter.cuentas[0]!)

    // Lo mismo que hace la app cuando el lead contesta.
    await pool.query(
      `update lead_assignments set estado = 'respondido', respondido_at = now() where id = $1`,
      [asignacion],
    )
    await pool.query(`update contacts set stage = 'respondido' where id = $1`, [contactId])

    const r = await vaciarElEquipo(null, db)
    expect(r.conRespuesta).toBe(1)
    expect(r.alPozo).toBe(0)

    // Sigue existiendo y sigue fuera del pozo: ya hay una conversación abierta.
    expect(await contarPozo(db)).toBe(0)
    const quedo = await pool.query('select stage from contacts where id = $1', [contactId])
    expect(quedo.rows[0]).toMatchObject({ stage: 'respondido' })
  })

  it('no toca las cuentas de admin', async () => {
    await pool.query(
      `insert into users (email, name, password_hash, role)
       values ('jefe@test.local', 'Jefe', 'x', 'admin')`,
    )
    await crearSetter(pool, { cupos: [30] })

    await vaciarElEquipo(null, db)

    const admins = await pool.query(`select 1 from users where role = 'admin'`)
    expect(admins.rows).toHaveLength(1)
  })
})

/**
 * El que todavía no estrenó su acceso no recibe leads, y los que ya tenía
 * vuelven al pozo.
 *
 * Es la diferencia entre repartir y desperdiciar: un lead en la cola de alguien
 * que no puede abrir la app está fuera de circulación 48 horas sin que nadie lo
 * toque, y con un equipo recién dado de alta eso es el pozo entero.
 */
describe('el reparto espera a que estrenen el acceso', () => {
  it('no le entrega leads al que nunca entró', async () => {
    await crearSetter(pool, { cupos: [30], nuncaEntro: true })
    for (let i = 0; i < 10; i++) await crearLeadScrapeado(pool, i)

    const r = await repartirAhora(null, db)
    expect(r.entregados).toBe(0)
    expect(await contarPozo(db)).toBe(10)
  })

  it('tampoco al que entró pero sigue con la contraseña del alta', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    await pool.query(
      `update users set must_change_password = true where id = $1`,
      [setter.userId],
    )
    for (let i = 0; i < 10; i++) await crearLeadScrapeado(pool, i)

    expect((await repartirAhora(null, db)).entregados).toBe(0)
  })

  it('los que ya tenía tomados vuelven al pozo al repartir', async () => {
    const dormido = await crearSetter(pool, { cupos: [30], nuncaEntro: true })
    const activo = await crearSetter(pool, { cupos: [30] })

    // Se los habían entregado antes de esta regla: están congelados.
    await asignar(pool, await crearLeadScrapeado(pool, 1), dormido.setterId)
    await asignar(pool, await crearLeadScrapeado(pool, 2), dormido.setterId)
    expect(await contarPozo(db)).toBe(0)

    const r = await repartirAhora(null, db)
    expect(r.recuperados).toBe(2)

    // Y en la misma pasada se los lleva el que sí puede trabajarlos.
    expect(r.entregados).toBe(2)
    const suyos = await pool.query(
      `select count(*)::int as n from lead_assignments
        where setter_id = $1 and estado = 'asignado'`,
      [activo.setterId],
    )
    expect(suyos.rows[0]).toMatchObject({ n: 2 })
  })

  it('al estrenar el acceso recibe su tanda en el acto, sin esperar a mañana', async () => {
    const setter = await crearSetter(pool, { tanda: 5, cupos: [30], nuncaEntro: true })
    for (let i = 0; i < 10; i++) await crearLeadScrapeado(pool, i)

    // El reparto del día ya salió y a él no le tocó nada.
    expect((await repartirAhora(null, db)).entregados).toBe(0)

    // Entra y cambia la contraseña: es lo que hace la pantalla de cambio.
    await pool.query(
      `update users set must_change_password = false, last_login_at = now() where id = $1`,
      [setter.userId],
    )

    const n = await repartirAEsteSetter(setter.setterId, null, db)
    expect(n).toBe(5)
    expect(await contarPozo(db)).toBe(5)
  })
})

/**
 * El setter carga a alguien que conoce.
 *
 * Es el mejor lead que puede entrar al sistema —hay confianza antes del primer
 * mensaje— y lo único que no puede pasar es que rompa las dos reglas que
 * sostienen todo lo demás: un negocio lo trabaja un solo setter, y el mismo
 * negocio no entra dos veces.
 */
describe('leads propios del setter', () => {
  it('lo agrega a su cola y queda como suyo', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })

    const r = await agregarLeadPropio(
      setter.setterId,
      { instagram: '@PanaderiaDelBarrio', negocio: 'Panadería del Barrio', ciudad: 'Catamarca' },
      null,
      db,
    )
    expect(r.ok).toBe(true)

    const suyos = await pool.query(
      `select c.ig_username, c.business_name, c.origen, la.estado
         from lead_assignments la join contacts c on c.id = la.contact_id
        where la.setter_id = $1`,
      [setter.setterId],
    )
    expect(suyos.rows).toHaveLength(1)
    // La arroba y las mayúsculas se normalizan: es la misma cuenta.
    expect(suyos.rows[0]).toMatchObject({
      ig_username: 'panaderiadelbarrio',
      estado: 'asignado',
      origen: 'scrapeado',
    })
  })

  it('no se lo puede robar a otro setter', async () => {
    const primero = await crearSetter(pool, { cupos: [30] })
    const segundo = await crearSetter(pool, { cupos: [30] })

    await agregarLeadPropio(primero.setterId, { instagram: 'local.esquina', negocio: 'Local' }, null, db)
    const r = await agregarLeadPropio(
      segundo.setterId,
      { instagram: '@local.esquina', negocio: 'Local de la esquina' },
      null,
      db,
    )

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/trabajando/i)

    const cuantos = await pool.query(`select count(*)::int as n from lead_assignments`)
    expect(cuantos.rows[0]).toMatchObject({ n: 1 })
  })

  it('el mismo negocio no entra dos veces ni para el mismo setter', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    await agregarLeadPropio(setter.setterId, { instagram: 'gym.norte', negocio: 'Gym' }, null, db)

    const r = await agregarLeadPropio(setter.setterId, { instagram: 'gym.norte', negocio: 'Gym' }, null, db)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/ya está en tu lista/i)

    const contactos = await pool.query(`select count(*)::int as n from contacts`)
    expect(contactos.rows[0]).toMatchObject({ n: 1 })
  })

  it('un lead que ya volvió al pozo se puede agregar', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const contactId = await crearLeadScrapeado(pool, 1)
    await pool.query(`update contacts set ig_username = $1, dedupe_key = $2 where id = $3`, [
      'kiosco.centro',
      'ig:kiosco.centro',
      contactId,
    ])
    const vieja = await asignar(pool, contactId, setter.setterId)
    await pool.query(`update lead_assignments set estado = 'vencido' where id = $1`, [vieja])

    const r = await agregarLeadPropio(
      setter.setterId,
      { instagram: 'kiosco.centro', negocio: 'Kiosco del Centro' },
      null,
      db,
    )
    expect(r.ok).toBe(true)

    // No se duplicó el contacto: es el mismo negocio volviendo.
    const contactos = await pool.query(`select count(*)::int as n from contacts`)
    expect(contactos.rows[0]).toMatchObject({ n: 1 })
  })

  it('rechaza una cuenta de Instagram que no lo parece', async () => {
    const setter = await crearSetter(pool, { cupos: [30] })
    const r = await agregarLeadPropio(
      setter.setterId,
      { instagram: 'no es una cuenta', negocio: 'Algo' },
      null,
      db,
    )
    expect(r.ok).toBe(false)
  })
})

import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { asignar, crearDb, crearPool, crearSetter, limpiar } from '@/test/db'

import { devolverAlPozoEnLote, listarContactos } from './contacts'

/**
 * Qué contactos se ven en la pantalla de contactos.
 *
 * La regla que esto fija es la que antes no se cumplía: un negocio que trabajé
 * y después di de baja **sigue apareciendo**. Era invisible porque el listado
 * arrancaba con `discardedAt is null`, así que no había forma de revisar a
 * quién le había escrito si el lead ya estaba descartado.
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

/** Un contacto con los campos que deciden si se ve y en qué filtro cae. */
async function crear(opts: {
  negocio: string
  enviados?: number
  salidaAt?: string | null
  bajaAt?: string | null
}): Promise<void> {
  await pool.query(
    `insert into contacts
       (business_name, ig_username, has_instagram, origen, dedupe_key,
        sent_count, last_outbound_at, discarded_at)
     values ($1, $2, true, 'scrapeado', $2, $3, $4::timestamptz, $5::timestamptz)`,
    [
      opts.negocio,
      opts.negocio.toLowerCase().replace(/[^a-z0-9]/g, ''),
      opts.enviados ?? 0,
      opts.salidaAt ?? null,
      opts.bajaAt ?? null,
    ],
  )
}

/** Un mensaje saliente del contacto, como el que deja un envío de setter. */
async function mensajeSaliente(negocio: string, deshecho = false): Promise<void> {
  await pool.query(
    `insert into messages (contact_id, channel, direction, body, status, undone_at)
     select id, 'instagram', 'out', 'Hola!', 'enviado',
            case when $2 then now() else null end
       from contacts where business_name = $1`,
    [negocio, deshecho],
  )
}

const nombres = (filas: Array<{ businessName: string }>): string[] =>
  filas.map((f) => f.businessName).sort()

describe('listarContactos', () => {
  it('muestra los dados de baja junto con los activos', async () => {
    await crear({ negocio: 'Activo' })
    await crear({ negocio: 'De baja', bajaAt: 'now' })

    const filas = await listarContactos({}, 5000, db)

    expect(nombres(filas)).toEqual(['Activo', 'De baja'])
  })

  it('devuelve la fecha de baja, que es lo que la tabla usa para marcarla', async () => {
    await crear({ negocio: 'De baja', bajaAt: 'now' })

    const [fila] = await listarContactos({}, 5000, db)

    expect(fila?.discardedAt).toBeInstanceOf(Date)
  })

  it('separa las bajas cuando se lo piden', async () => {
    await crear({ negocio: 'Activo' })
    await crear({ negocio: 'De baja', bajaAt: 'now' })

    const sin = await listarContactos({ baja: 'sin' }, 5000, db)
    const solo = await listarContactos({ baja: 'solo' }, 5000, db)

    expect(nombres(sin)).toEqual(['Activo'])
    expect(nombres(solo)).toEqual(['De baja'])
  })

  it('cuenta como contactado al que tiene fecha de salida sin contador', async () => {
    // Es el caso del setter que manda el DM a mano: queda la fecha, no el conteo.
    await crear({ negocio: 'Por contador', enviados: 2 })
    await crear({ negocio: 'Por fecha', salidaAt: 'now' })
    await crear({ negocio: 'Nunca' })

    const filas = await listarContactos({ contactados: 'si' }, 5000, db)

    expect(nombres(filas)).toEqual(['Por contador', 'Por fecha'])
  })

  it('los nunca contactados son exactamente el complemento', async () => {
    await crear({ negocio: 'Por contador', enviados: 2 })
    await crear({ negocio: 'Por fecha', salidaAt: 'now' })
    await crear({ negocio: 'Nunca' })

    const filas = await listarContactos({ contactados: 'no' }, 5000, db)

    expect(nombres(filas)).toEqual(['Nunca'])
  })

  it('sigue siendo hablado después de vaciar el equipo', async () => {
    /*
     * El caso que importa y que los contadores solos no cubren:
     * `vaciarElEquipo` pone sent_count en 0 y last_outbound_at en null, pero
     * no borra los mensajes. Sin mirar `messages`, este lead se perdía.
     */
    await crear({ negocio: 'Contactado antes del vaciado' })
    await mensajeSaliente('Contactado antes del vaciado')

    const filas = await listarContactos({ contactados: 'si' }, 5000, db)

    expect(nombres(filas)).toEqual(['Contactado antes del vaciado'])
  })

  it('un envío deshecho y sin contadores no cuenta como hablado', async () => {
    // Deshacer sella el mensaje con undone_at en vez de borrarlo.
    await crear({ negocio: 'Marcado sin querer' })
    await mensajeSaliente('Marcado sin querer', true)

    const si = await listarContactos({ contactados: 'si' }, 5000, db)
    const no = await listarContactos({ contactados: 'no' }, 5000, db)

    expect(si).toEqual([])
    expect(nombres(no)).toEqual(['Marcado sin querer'])
  })

  it('encuentra a los que contacté aunque después los haya dado de baja', async () => {
    // La pregunta que motivó todo esto: a quién le escribí alguna vez.
    await crear({ negocio: 'Contactado y de baja', enviados: 1, bajaAt: 'now' })

    const filas = await listarContactos({ contactados: 'si' }, 5000, db)

    expect(nombres(filas)).toEqual(['Contactado y de baja'])
  })
})

describe('devolverAlPozoEnLote', () => {
  /** El id del contacto, que es con lo que trabaja la acción. */
  async function idDe(negocio: string): Promise<string> {
    const r = await pool.query<{ id: string }>(
      'select id from contacts where business_name = $1',
      [negocio],
    )
    return r.rows[0]!.id
  }

  async function leer(negocio: string) {
    const r = await pool.query(
      `select stage, sequence_step, sent_count, last_outbound_at, discarded_at, next_followup_at
         from contacts where business_name = $1`,
      [negocio],
    )
    return r.rows[0]!
  }

  it('lo deja en nuevo sin borrar que ya le hablamos', async () => {
    await crear({ negocio: 'Contactado', enviados: 3, salidaAt: 'now' })
    await pool.query(
      `update contacts set stage = 'sin_respuesta', sequence_step = 2,
              next_followup_at = now() where business_name = 'Contactado'`,
    )

    const r = await devolverAlPozoEnLote([await idDe('Contactado')], null, db)
    const c = await leer('Contactado')

    expect(r).toEqual({ tirados: 1, saltados: 0, revividos: 0 })
    expect(c.stage).toBe('nuevo')
    expect(c.sequence_step).toBe(0)
    expect(c.next_followup_at).toBeNull()
    // Lo que importa: la historia no se borra.
    expect(c.sent_count).toBe(3)
    expect(c.last_outbound_at).not.toBeNull()
  })

  it('sigue apareciendo en Hablados después de tirarlo al pozo', async () => {
    await crear({ negocio: 'Vuelve al pozo', enviados: 1, salidaAt: 'now' })

    await devolverAlPozoEnLote([await idDe('Vuelve al pozo')], null, db)
    const hablados = await listarContactos({ contactados: 'si' }, 5000, db)

    expect(nombres(hablados)).toEqual(['Vuelve al pozo'])
  })

  it('revive al que estaba dado de baja', async () => {
    await crear({ negocio: 'De baja', enviados: 1, bajaAt: 'now' })

    const r = await devolverAlPozoEnLote([await idDe('De baja')], null, db)

    expect(r.revividos).toBe(1)
    expect((await leer('De baja')).discarded_at).toBeNull()
  })

  it('no toca a los marcados como no contactar', async () => {
    await crear({ negocio: 'No contactar', enviados: 1 })
    await pool.query(
      `update contacts set stage = 'no_contactar' where business_name = 'No contactar'`,
    )

    const r = await devolverAlPozoEnLote([await idDe('No contactar')], null, db)

    expect(r).toEqual({ tirados: 0, saltados: 1, revividos: 0 })
    expect((await leer('No contactar')).stage).toBe('no_contactar')
  })

  it('libera la asignación activa, que es lo que permite reasignarlo', async () => {
    /*
     * `lead_assignments_activo_uq` deja como máximo una asignación por
     * contacto que no haya vuelto al pozo. Si la vieja queda activa, el reparto
     * no puede darle el lead a nadie y queda en 'nuevo' para siempre.
     */
    const setter = await crearSetter(pool)
    await crear({ negocio: 'Asignado', enviados: 1 })
    const id = await idDe('Asignado')
    await asignar(pool, id, setter.setterId)

    await devolverAlPozoEnLote([id], null, db)

    const activas = await pool.query(
      `select count(*)::int as n from lead_assignments
        where contact_id = $1 and estado not in ('vencido', 'devuelto')`,
      [id],
    )
    const devuelta = await pool.query(
      `select estado, devuelto_motivo from lead_assignments where contact_id = $1`,
      [id],
    )

    expect(activas.rows[0]!.n).toBe(0)
    expect(devuelta.rows[0]!.estado).toBe('devuelto')
    expect(devuelta.rows[0]!.devuelto_motivo).toContain('de nuevo')
  })

  it('deja constancia de la etapa de la que volvió cada uno', async () => {
    await crear({ negocio: 'Perdido', enviados: 1 })
    await pool.query(`update contacts set stage = 'perdido' where business_name = 'Perdido'`)

    await devolverAlPozoEnLote([await idDe('Perdido')], null, db)

    const ev = await pool.query(
      `select payload_jsonb as p from events
        where type = 'etapa_cambiada' and payload_jsonb->>'motivo' = 'tirado_al_pozo'`,
    )
    expect(ev.rows).toHaveLength(1)
    expect(ev.rows[0]!.p).toMatchObject({ desde: 'perdido', hasta: 'nuevo' })
  })

  it('con una lista vacía no hace nada', async () => {
    expect(await devolverAlPozoEnLote([], null, db)).toEqual({
      tirados: 0,
      saltados: 0,
      revividos: 0,
    })
  })
})

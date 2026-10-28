import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { crearDb, crearPool, limpiar } from '@/test/db'

import { listarContactos } from './contacts'

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

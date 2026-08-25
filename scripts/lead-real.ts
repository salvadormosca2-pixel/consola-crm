import './load-env'

import { Pool } from 'pg'

/**
 * Mueve los leads reales de la demo al setter que quieras.
 *
 *   npm run demo:lead-real -- diego@demo.local
 *   npm run demo:lead-real -- pozo          (los devuelve sin dueño)
 *   npm run demo:lead-real                  (dice quién tiene cada uno)
 *
 * Existe porque **un lead no puede estar en dos setters a la vez**: la
 * base lo prohíbe con `lead_assignments_activo_uq`, que es la regla que
 * garantiza que dos personas nunca le escriban al mismo negocio. Para grabar,
 * que igual se filma una pantalla por vez, se mueve y listo.
 *
 * El traspaso usa el mismo mecanismo que el sistema de verdad: la asignación
 * anterior se marca devuelta —no se borra— así queda el rastro de por dónde
 * pasó el lead, igual que cuando vence en la vida real.
 */

/** Los leads con perfil de Instagram de verdad. Se mueven juntos. */
const USUARIOS = ['salvamosca', 'nachocano']

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

interface Real {
  id: string
  usuario: string
  negocio: string
}

async function leerReales(): Promise<Real[]> {
  const c = await pool.query<{ id: string; ig_username: string; business_name: string }>(
    `select id, ig_username, business_name from contacts
      where lower(ig_username) = any($1::text[]) order by ig_username`,
    [USUARIOS],
  )
  return c.rows.map((f) => ({ id: f.id, usuario: f.ig_username, negocio: f.business_name }))
}

/** Quién tiene cada uno ahora. */
async function mostrarEstado(reales: Real[]): Promise<void> {
  console.log('')
  for (const r of reales) {
    const quien = await pool.query<{ nombre: string; estado: string }>(
      `select u.name as nombre, la.estado
         from lead_assignments la
         join setters s on s.id = la.setter_id
         join users u on u.id = s.user_id
        where la.contact_id = $1 and la.estado not in ('vencido', 'devuelto')`,
      [r.id],
    )
    const a = quien.rows[0]
    console.log(
      a
        ? `  @${r.usuario.padEnd(14)} lo tiene ${a.nombre} (${a.estado})`
        : `  @${r.usuario.padEnd(14)} en el pozo, sin dueño`,
    )
  }

  console.log(`\nPara moverlos:  npm run demo:lead-real -- <email del setter>`)
  const setters = await pool.query<{ email: string }>(
    `select u.email from users u join setters s on s.user_id = u.id
      where u.status = 'activo' order by u.name`,
  )
  console.log(setters.rows.map((s) => `  ${s.email}`).join('\n') + '\n')
}

/**
 * Vuelve a nacer sin tocar: sin contactar, sin respuesta y con el vencimiento
 * entero por delante. Así la cola lo muestra con el mensaje de entrada listo y
 * se puede grabar el recorrido desde cero cuantas veces haga falta.
 */
async function reasignar(real: Real, setterId: string, horas: number): Promise<void> {
  await pool.query(
    `insert into lead_assignments (contact_id, setter_id, estado, asignado_at, vence_at)
     values ($1, $2, 'asignado', now(), now() + ($3::text || ' hours')::interval)`,
    [real.id, setterId, String(horas)],
  )
  await pool.query(
    `update contacts set stage = 'nuevo', setter_id = null, sent_count = 0,
                         received_count = 0, last_outbound_at = null,
                         last_inbound_at = null, first_replied_at = null,
                         sequence_step = 0, updated_at = now()
      where id = $1`,
    [real.id],
  )
  await pool.query(`delete from setter_sends where contact_id = $1`, [real.id])
}

async function main(): Promise<void> {
  const destino = process.argv[2]?.trim().toLowerCase()
  const reales = await leerReales()

  if (reales.length === 0) {
    console.log(`\nNo hay leads reales cargados. Corré primero:  npm run demo:setters\n`)
    return
  }

  if (!destino) {
    await mostrarEstado(reales)
    return
  }

  // Las asignaciones viejas se sellan como devueltas: recién ahí el índice
  // único deja entrar las nuevas.
  await pool.query(
    `update lead_assignments
        set estado = 'devuelto', devuelto_at = now(),
            devuelto_motivo = 'Reasignado a mano para la demostración.'
      where contact_id = any($1::uuid[]) and estado not in ('vencido', 'devuelto')`,
    [reales.map((r) => r.id)],
  )

  if (destino === 'pozo') {
    await pool.query(
      `update contacts set stage = 'nuevo', setter_id = null, sent_count = 0,
                           received_count = 0, updated_at = now()
        where id = any($1::uuid[])`,
      [reales.map((r) => r.id)],
    )
    console.log(
      `\n${reales.map((r) => '@' + r.usuario).join(' y ')} volvieron al pozo.` +
        `\nCualquier setter los puede pedir desde su cola.\n`,
    )
    return
  }

  const s = await pool.query<{ id: string; nombre: string }>(
    `select s.id, u.name as nombre from setters s join users u on u.id = s.user_id
      where lower(u.email) = $1 and u.status = 'activo'`,
    [destino],
  )
  const setter = s.rows[0]
  if (!setter) {
    console.log(`\nNo encontré un setter activo con el email ${destino}.\n`)
    return
  }

  // Una hora de diferencia entre uno y otro: la cola ordena por el que vence
  // antes, así quedan los dos arriba y siempre en el mismo orden.
  for (const [i, real] of reales.entries()) {
    await reasignar(real, setter.id, 44 + i)
  }

  console.log(`\nAhora son de ${setter.nombre}:`)
  for (const r of reales) console.log(`  @${r.usuario}  (${r.negocio})`)
  console.log(`\nEntrá con ${destino} y van a estar primeros en su cola, sin contactar.\n`)
}

main()
  .catch((e) => {
    console.error('\n', e instanceof Error ? e.message : e, '\n')
    process.exitCode = 1
  })
  .finally(() => pool.end())

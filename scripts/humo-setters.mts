import './load-env'

import { db } from '../src/db'
import { asignarLeads, contarPozo } from '../src/server/setters/asignacion'
import { armarColaDelSetter } from '../src/server/setters/cola'
import { leerCupoDeSetter } from '../src/server/setters/cupo'
import { registrarEnvio } from '../src/server/setters/envios'
import { armarTablero } from '../src/server/setters/panel'
import { pool } from '../src/db'
import { sql } from 'drizzle-orm'

/**
 * Prueba de humo del módulo de setters contra la base de desarrollo.
 *
 * No reemplaza a los tests (que corren contra la base de test y prueban las
 * reglas duras): esto recorre el camino completo con datos de demostración para
 * ver que las piezas encajan — reparto, cola, plantilla armada, cupo, cambio de
 * cuenta y tablero.
 *
 *   npm run demo:setters && npx tsx scripts/humo-setters.ts
 */
async function main(): Promise<void> {
  const setters = await db.execute(sql`
    select s.id, u.name from setters s join users u on u.id = s.user_id order by u.name limit 1
  `)
  const setter = setters.rows[0] as { id: string; name: string } | undefined
  if (!setter) throw new Error('No hay setters. Corré: npm run demo:setters')

  console.log(`Setter: ${setter.name}`)
  console.log(`Pozo: ${await contarPozo()} leads sin asignar`)

  const asignados = await asignarLeads(setter.id, 5, null)
  console.log(`Asignados ahora: ${asignados}`)

  const cola = await armarColaDelSetter(setter.id)
  console.log(`Cola: ${cola.items.length} items · ${cola.nuevos} nuevos · ${cola.seguimientos} seguimientos`)

  const primero = cola.items[0]
  if (!primero) throw new Error('La cola quedó vacía: revisá el pozo y las plantillas.')

  console.log(`\nPrimero: ${primero.businessName} (@${primero.igUsername})`)
  console.log(`Link:    ${primero.linkDirecto}`)
  console.log(`Mensaje: ${primero.mensaje ?? `BLOQUEADO — ${primero.motivoBloqueo}`}`)

  if (!primero.mensaje) throw new Error('El mensaje no se pudo armar: revisá las plantillas.')

  const cupoAntes = await leerCupoDeSetter(setter.id)
  console.log(`\nCuenta activa: @${cupoAntes.activa?.igUsername} · ${cupoAntes.usadoHoy}/${cupoAntes.cupoTotal}`)

  const envio = await registrarEnvio({
    assignmentId: primero.assignmentId,
    setterId: setter.id,
    cuentaId: cupoAntes.activa!.id,
    tipo: primero.tipo,
    body: primero.mensaje,
    templateId: primero.templateId,
    templateVariant: primero.templateVariant,
    actorUserId: null,
  })

  console.log(`Envío: ${envio.ok ? `ok · ${envio.usadoHoy}/${envio.cupo} · segundo el ${envio.segundoAt?.toISOString().slice(0, 16)}` : `rechazado (${envio.motivo}): ${envio.detalle}`}`)

  const repetido = await registrarEnvio({
    assignmentId: primero.assignmentId,
    setterId: setter.id,
    cuentaId: cupoAntes.activa!.id,
    tipo: primero.tipo,
    body: primero.mensaje,
    templateId: primero.templateId,
    templateVariant: primero.templateVariant,
    actorUserId: null,
  })
  console.log(`Repetido: ${repetido.ok && repetido.duplicado ? 'absorbido, no consumió cupo de nuevo' : 'PROBLEMA'}`)

  const tablero = await armarTablero()
  console.log('\nTablero del día:')
  for (const f of tablero) {
    const cuentas = (f.cupo?.cuentas ?? [])
      .map((c) => `@${c.igUsername} ${c.enviadosHoy}/${c.cupoDiario}`)
      .join('  ')
    console.log(
      `  ${f.nombre.padEnd(16)} ${cuentas.padEnd(46)} hoy ${f.hoy}/${f.tanda}  ${f.semaforo}  ${f.motivo}`,
    )
  }

  await pool.end()
}

main().catch((err: unknown) => {
  console.error('\n', err instanceof Error ? err.stack : err)
  process.exit(1)
})

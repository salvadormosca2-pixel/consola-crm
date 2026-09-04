import 'server-only'

import { sql } from 'drizzle-orm'

import { db, type Db, type Ejecutor } from '@/db'
import { primerPasoDe } from '@/lib/pistas'
import { cuandoSale } from '@/lib/setters-config'
import { leerConfigSetters } from '@/server/setters/config'

/**
 * Los leads que quedaron en un estado que no lleva a ningún lado.
 *
 * Todo lead vivo tiene que estar esperando **algo**: que el setter le mande el
 * mensaje que le toca, que el lead conteste, o que un admin lo clasifique. Si
 * no está esperando nada, no aparece en ninguna pantalla y nadie lo va a mirar
 * nunca más: no está en la cola del setter, no está en el pozo, y no está en la
 * cola de clasificación. Está, y no existe.
 *
 * Se llega ahí cuando la cadena se corta a mitad de camino: un mensaje que se
 * mandó y se registró sin poder programar lo que seguía, o un lead que quedó de
 * una versión vieja del flujo, cuando los pasos eran otros. No es culpa de
 * nadie y no se nota — justamente porque desaparece de las pantallas.
 *
 * Esta revisión los busca y los devuelve al escalón que les corresponde.
 */

export interface RevisionDeLeads {
  /** Recibieron un mensaje y no esperan nada: no aparecen en ninguna pantalla. */
  parados: number
  /** Contestaron la oferta y nadie decidió por dónde siguen. */
  sinClasificar: number
  /** Contestaron la entrada y todavía no recibieron la oferta. */
  esperandoLaOferta: number
}

/**
 * Parado = recibió algo, no espera nada y nunca entró a una escalera.
 *
 * La última condición es la que separa un lead roto de uno que terminó bien:
 * el que recorrió su pista entera también queda sin próximo paso, y ese está
 * como tiene que estar —en nurture, esperando a que pasen los meses.
 */
const PARADO = sql`
  la.estado in ('contactado', 'segundo_enviado')
  and la.proximo_paso is null
  and la.proximo_seguimiento_at is null
  and la.respondio_a is distinct from 'segundo'
  and not exists (
    select 1 from setter_sends ss
     where ss.assignment_id = la.id and ss.paso > 2 and ss.undone_at is null
  )
`

export async function revisarLeads(cliente: Ejecutor = db): Promise<RevisionDeLeads> {
  const filas = await cliente.execute(sql`
    select
      count(*) filter (where ${PARADO})::int as parados,
      count(*) filter (where la.respondio_a = 'segundo' and la.clasificado_at is null
                         and la.estado not in ('vencido', 'devuelto'))::int as sin_clasificar,
      count(*) filter (where la.respondio_a = 'primero' and la.segundo_mensaje_at is null
                         and la.estado not in ('vencido', 'devuelto'))::int as esperando_oferta
      from lead_assignments la
  `)
  const f = filas.rows[0] as
    | { parados: number; sin_clasificar: number; esperando_oferta: number }
    | undefined

  return {
    parados: f?.parados ?? 0,
    sinClasificar: f?.sin_clasificar ?? 0,
    esperandoLaOferta: f?.esperando_oferta ?? 0,
  }
}

/**
 * Los devuelve al escalón que les corresponde.
 *
 * A cada uno le toca lo mismo que le habría tocado si la cadena no se hubiera
 * cortado: al que recibió la entrada y nadie contestó, el reintento de
 * apertura; al que recibió la oferta y no contestó, el primer escalón de
 * silencio. Y contado **desde su último mensaje**, no desde hoy: un lead de
 * hace tres semanas tiene que salir ahora, no dentro de siete días.
 */
export async function repararLeadsParados(
  actorUserId: string | null,
  cliente: Db = db,
): Promise<number> {
  const cfg = await leerConfigSetters(cliente)

  const filas = await cliente.execute(sql`
    select la.id, la.estado, la.contactado_at, la.segundo_mensaje_at, la.contact_id
      from lead_assignments la
     where ${PARADO}
     limit 500
  `)

  const rotos = filas.rows as Array<{
    id: string
    estado: string
    contactado_at: Date | null
    segundo_mensaje_at: Date | null
    contact_id: string
  }>
  if (rotos.length === 0) return 0

  const reintento = primerPasoDe('sin_abrir').paso
  const silencio = primerPasoDe('silencio').paso

  await cliente.transaction(async (tx) => {
    for (const r of rotos) {
      const seGuiaPorLaOferta = r.estado === 'segundo_enviado'
      const paso = seGuiaPorLaOferta ? silencio : reintento
      const desde = seGuiaPorLaOferta
        ? (r.segundo_mensaje_at ?? r.contactado_at ?? new Date())
        : (r.contactado_at ?? new Date())

      await tx.execute(sql`
        update lead_assignments
           set proximo_paso = ${paso},
               proximo_seguimiento_at = ${cuandoSale(cfg, paso, new Date(desde)).toISOString()}::timestamptz
         where id = ${r.id}::uuid
      `)
    }

    await tx.execute(sql`
      insert into events (type, actor_user_id, payload_jsonb)
      values ('lead_reprogramado', ${actorUserId}::uuid,
              ${JSON.stringify({ cantidad: rotos.length })}::jsonb)
    `)
  })

  return rotos.length
}

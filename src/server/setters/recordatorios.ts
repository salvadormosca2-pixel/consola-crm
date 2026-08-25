import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'
import type { RecordatorioTipo } from '@/db/enums'
import { opsDate, OPS_TZ } from '@/lib/tz'
import { enviarPush } from '@/server/push'

/**
 * Recordatorios a los setters.
 *
 * Un recordatorio que dice "hacé los seguimientos" no mueve a nadie. Uno que
 * dice "te quedan 15, 8 con 2 días de atraso" sí: el número exacto es lo que
 * convierte un pedido en una tarea.
 *
 * Cada envío queda registrado con sus números, así no lo mando tres veces ni me
 * olvido de mandarlo, y después puedo ver si hizo algo después de cada uno.
 */

export interface PendientesDeSetter {
  setterId: string
  userId: string
  nombre: string
  pendientes: number
  atrasados: number
  diasAtraso: number
  sinContactar: number
  vencenHoy: number
}

/** Los números de un setter, o de todos si no se pasa ninguno. */
export async function contarPendientes(setterId?: string): Promise<PendientesDeSetter[]> {
  const hoy = opsDate()

  const filas = await db.execute(sql`
    select s.id as setter_id, u.id as user_id, u.name as nombre,

           (select count(*)::int from lead_assignments la
             where la.setter_id = s.id and la.estado = 'contactado'
               and la.segundo_programado_at is not null
               and la.segundo_programado_at <= now()) as pendientes,

           (select count(*)::int from lead_assignments la
             where la.setter_id = s.id and la.estado = 'contactado'
               and la.segundo_programado_at is not null
               and (la.segundo_programado_at at time zone ${OPS_TZ})::date < ${hoy}::date)
             as atrasados,

           coalesce((select max(
                       greatest(0, (now() at time zone ${OPS_TZ})::date
                                   - (la.segundo_programado_at at time zone ${OPS_TZ})::date))::int
                       from lead_assignments la
                      where la.setter_id = s.id and la.estado = 'contactado'
                        and la.segundo_programado_at is not null
                        and la.segundo_programado_at <= now()), 0) as dias_atraso,

           (select count(*)::int from lead_assignments la
             where la.setter_id = s.id
               and la.estado in ('asignado', 'abierto', 'saltado')) as sin_contactar,

           (select count(*)::int from lead_assignments la
             where la.setter_id = s.id
               and la.estado in ('asignado', 'abierto', 'saltado')
               and (la.vence_at at time zone ${OPS_TZ})::date <= ${hoy}::date) as vencen_hoy

      from setters s
      join users u on u.id = s.user_id
     where u.status = 'activo'
       ${setterId ? sql`and s.id = ${setterId}::uuid` : sql``}
     order by u.name asc
  `)

  return (filas.rows as Array<{
    setter_id: string
    user_id: string
    nombre: string
    pendientes: number
    atrasados: number
    dias_atraso: number
    sin_contactar: number
    vencen_hoy: number
  }>).map((f) => ({
    setterId: f.setter_id,
    userId: f.user_id,
    nombre: f.nombre,
    pendientes: f.pendientes,
    atrasados: f.atrasados,
    diasAtraso: f.dias_atraso,
    sinContactar: f.sin_contactar,
    vencenHoy: f.vencen_hoy,
  }))
}

/** El texto exacto. Los números van adentro, no en un "tenés pendientes". */
export function textoDelRecordatorio(p: PendientesDeSetter, tipo: RecordatorioTipo): string {
  if (tipo === 'seguimientos') {
    const base =
      p.pendientes === 1
        ? 'Te queda 1 seguimiento pendiente'
        : `Te quedan ${p.pendientes} seguimientos pendientes`
    if (p.atrasados === 0) return `${base}.`
    return `${base}, ${p.atrasados} con ${p.diasAtraso === 1 ? '1 día' : `${p.diasAtraso} días`} de atraso.`
  }

  const base =
    p.sinContactar === 1
      ? 'Tenés 1 lead sin contactar'
      : `Tenés ${p.sinContactar} leads sin contactar`
  if (p.vencenHoy === 0) return `${base}.`
  return `${base}, ${p.vencenHoy} ${p.vencenHoy === 1 ? 'vence' : 'vencen'} hoy.`
}

/** Si no hay nada pendiente, no se manda nada: un aviso vacío enseña a ignorar. */
export function tieneAlgoQueHacer(p: PendientesDeSetter, tipo: RecordatorioTipo): boolean {
  return tipo === 'seguimientos' ? p.pendientes > 0 : p.sinContactar > 0
}

/**
 * Manda el recordatorio: notificación al celular y aviso fijo al abrir la app.
 * Las dos cosas, porque el push puede estar sin permiso y el aviso al abrir
 * llega tarde: juntas cubren los dos casos.
 */
export async function mandarRecordatorio(params: {
  pendientes: PendientesDeSetter
  tipo: RecordatorioTipo
  automatico: boolean
  enviadoPor: string | null
}): Promise<boolean> {
  const { pendientes: p, tipo, automatico, enviadoPor } = params
  if (!tieneAlgoQueHacer(p, tipo)) return false

  const texto = textoDelRecordatorio(p, tipo)

  await db.execute(sql`
    insert into recordatorios (setter_id, tipo, automatico, pendientes, atrasados,
                               dias_atraso, texto, enviado_por)
    values (${p.setterId}::uuid, ${tipo}, ${automatico}, ${p.pendientes}, ${p.atrasados},
            ${p.diasAtraso}, ${texto}, ${enviadoPor}::uuid)
  `)

  await db.execute(sql`
    insert into events (type, actor_user_id, payload_jsonb)
    values ('recordatorio_enviado', ${enviadoPor}::uuid,
            ${JSON.stringify({ setterId: p.setterId, tipo, automatico, texto })}::jsonb)
  `)

  await enviarPush([p.userId], {
    titulo: tipo === 'seguimientos' ? 'Seguimientos pendientes' : 'Leads sin contactar',
    cuerpo: texto,
    enlace: '/hoy',
    etiqueta: `recordatorio-${tipo}`,
  })

  return true
}

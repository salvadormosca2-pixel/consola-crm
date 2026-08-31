import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'

import { opsDate, opsTime, OPS_TZ } from '@/lib/tz'
import { barrer } from '@/server/setters/asignacion'
import { leerConfigSetters } from '@/server/setters/config'
import { repartoAutomaticoDelDia } from '@/server/setters/reparto'
import { notificar, notificarYAvisar } from '@/server/setters/notificaciones'
import { contarPendientes, mandarRecordatorio } from '@/server/setters/recordatorios'

/**
 * Todo lo que depende del reloj y no de que alguien abra una pantalla.
 *
 * El vencimiento de leads y el desalteado se resuelven solos al leer (ver
 * `barrer`), así que esto no es indispensable para que el sistema funcione: es
 * lo que hace que me entere de las cosas sin mirar. Se llama desde
 * `/api/tareas`, que puede dispararse desde cualquier programador —cron, el
 * Programador de tareas de Windows, un servicio externo— con el secreto.
 *
 * Todo lo de acá es **idempotente**: cada aviso lleva una clave con la fecha
 * adentro, así correrlo cinco veces en un día no manda cinco notificaciones.
 */

export interface ResumenDeTareas {
  vencidos: number
  desalteados: number
  repartidos: number
  recordatorios: number
  alertas: number
}

export async function correrTareas(): Promise<ResumenDeTareas> {
  const cfg = await leerConfigSetters()
  const hoy = opsDate()
  const ahora = opsTime()

  const { vencidos, desalteados } = await barrer()

  /*
   * Primero se reparte y después se avisa: si el reparto sale antes que los
   * recordatorios, el setter abre la app y ya tiene la tanda del día esperando
   * en vez de encontrarse la cola vacía.
   */
  const repartidos = await repartoAutomaticoDelDia()

  const recordatorios = await recordatoriosAutomaticos(ahora, hoy)
  const alertas =
    (await alertarAtrasos(hoy, cfg.diasAtrasoParaAlerta)) +
    (await alertarLeadsPorVencer(hoy, cfg.horasParaAvisarVencimiento)) +
    (await alertarCuentasFrias(hoy, cfg.tasaRespuestaMinima, cfg.minimoParaMedirTasa)) +
    (await alertarBloqueantesSinLeer()) +
    (ahora >= cfg.horaResumenDiario ? await alertarInactivos(hoy) : 0)

  return { vencidos, desalteados, repartidos, recordatorios, alertas }
}

/**
 * El recordatorio que sale solo a la hora que configuré por setter.
 *
 * Solo dispara si la hora ya pasó y todavía no le mandé nada hoy: si el
 * programador corre cada quince minutos, el aviso sale una sola vez.
 */
async function recordatoriosAutomaticos(ahora: string, hoy: string): Promise<number> {
  const filas = await db.execute(sql`
    select s.id
      from setters s
      join users u on u.id = s.user_id
     where u.status = 'activo'
       and s.recordatorio_automatico
       and to_char(s.hora_recordatorio, 'HH24:MI') <= ${ahora}
       and not exists (
         select 1 from recordatorios r
          where r.setter_id = s.id
            and r.automatico
            and (r.created_at at time zone ${OPS_TZ})::date = ${hoy}::date
       )
  `)

  let mandados = 0
  for (const f of filas.rows as Array<{ id: string }>) {
    const [pendientes] = await contarPendientes(f.id)
    if (!pendientes) continue
    const ok = await mandarRecordatorio({
      pendientes,
      tipo: 'seguimientos',
      automatico: true,
      enviadoPor: null,
    })
    if (ok) mandados++
  }
  return mandados
}

/** A los N días de atraso me llega la alerta y su nombre queda en rojo. */
async function alertarAtrasos(hoy: string, dias: number): Promise<number> {
  const filas = await db.execute(sql`
    select s.id, u.name,
           max(greatest(0, (now() at time zone ${OPS_TZ})::date
                           - (la.segundo_programado_at at time zone ${OPS_TZ})::date))::int as atraso
      from lead_assignments la
      join setters s on s.id = la.setter_id
      join users u on u.id = s.user_id
     where la.estado = 'contactado'
       and la.segundo_programado_at is not null
       and la.segundo_programado_at <= now()
       and u.status = 'activo'
     group by s.id, u.name
    having max(greatest(0, (now() at time zone ${OPS_TZ})::date
                           - (la.segundo_programado_at at time zone ${OPS_TZ})::date)) >= ${dias}
  `)

  let n = 0
  for (const f of filas.rows as Array<{ id: string; name: string; atraso: number }>) {
    const creada = await notificar({
      tipo: 'seguimientos_atrasados',
      texto: `${f.name} acumula ${f.atraso} días de atraso en sus seguimientos`,
      enlace: '/equipo/seguimientos',
      setterId: f.id,
      clave: `atraso:${f.id}:${hoy}`,
    })
    if (creada) n++
  }
  return n
}

/** "12 leads de Carla vencen en 6 horas". */
async function alertarLeadsPorVencer(hoy: string, horas: number): Promise<number> {
  const filas = await db.execute(sql`
    select s.id, u.name, count(*)::int as cuantos
      from lead_assignments la
      join setters s on s.id = la.setter_id
      join users u on u.id = s.user_id
     where la.estado in ('asignado', 'abierto', 'saltado')
       and la.vence_at between now() and now() + ${`${horas} hours`}::interval
       and u.status = 'activo'
     group by s.id, u.name
  `)

  let n = 0
  for (const f of filas.rows as Array<{ id: string; name: string; cuantos: number }>) {
    const creada = await notificar({
      tipo: 'leads_por_vencer',
      texto: `${f.cuantos} ${f.cuantos === 1 ? 'lead' : 'leads'} de ${f.name} ${
        f.cuantos === 1 ? 'vence' : 'vencen'
      } en ${horas} horas`,
      enlace: '/equipo/leads?ver=sin_contactar',
      setterId: f.id,
      clave: `porvencer:${f.id}:${hoy}`,
    })
    if (creada) n++
  }
  return n
}

/**
 * Cuentas con tasa de respuesta muy baja: casi siempre es una restricción de
 * Instagram, y verlo a tiempo es la diferencia entre perder tres días y perder
 * la cuenta.
 */
async function alertarCuentasFrias(
  hoy: string,
  tasaMinima: number,
  minimo: number,
): Promise<number> {
  const desde = opsDate(new Date(Date.now() - 6 * 86_400_000))

  const filas = await db.execute(sql`
    select sa.id, sa.ig_username, s.id as setter_id, u.name,
           count(*)::int as mandados,
           count(distinct la.id) filter (where la.respondido_at is not null)::int as respondieron
      from setter_sends ss
      join setter_accounts sa on sa.id = ss.setter_account_id
      join setters s on s.id = ss.setter_id
      join users u on u.id = s.user_id
      join lead_assignments la on la.id = ss.assignment_id
     where ss.undone_at is null and ss.ops_date >= ${desde}::date and sa.activa
     group by sa.id, sa.ig_username, s.id, u.name
    having count(*) >= ${minimo}
       and count(distinct la.id) filter (where la.respondido_at is not null)::numeric
            / count(*)::numeric < ${tasaMinima}
  `)

  let n = 0
  for (const f of filas.rows as Array<{
    id: string
    ig_username: string
    setter_id: string
    name: string
    mandados: number
    respondieron: number
  }>) {
    const pct = ((f.respondieron / f.mandados) * 100).toFixed(1)
    const creada = await notificar({
      tipo: 'cuenta_baja_respuesta',
      texto: `La cuenta @${f.ig_username} (${f.name}) lleva la semana con ${pct}% de respuestas — probable restricción`,
      enlace: `/equipo/${f.setter_id}`,
      setterId: f.setter_id,
      clave: `cuentafria:${f.id}:${hoy}`,
    })
    if (creada) n++
  }
  return n
}

/**
 * Un mensaje bloqueante nunca puede dejar a alguien sin poder trabajar más de
 * lo necesario. Si a las 24 h no lo leyó, me avisa a mí en vez de dejarlo
 * trabado sin que me entere.
 */
async function alertarBloqueantesSinLeer(): Promise<number> {
  const filas = await db.execute(sql`
    update mensajes_destinatarios md
       set alertado_at = now()
      from mensajes_equipo me, setters s, users u
     where me.id = md.mensaje_id
       and s.id = md.setter_id
       and u.id = s.user_id
       and me.nivel = 'bloqueante'
       and md.leido_at is null
       and md.alertado_at is null
       and me.created_at <= now() - interval '24 hours'
       and u.status = 'activo'
    returning md.setter_id, u.name, me.titulo
  `)

  let n = 0
  for (const f of filas.rows as Array<{ setter_id: string; name: string; titulo: string }>) {
    const creada = await notificar({
      tipo: 'mensaje_sin_leer',
      texto: `${f.name} lleva 24 h sin leer "${f.titulo}" y no puede empezar su cola`,
      enlace: '/equipo/avisos',
      setterId: f.setter_id,
      clave: `bloqueante:${f.setter_id}:${f.titulo}`,
    })
    if (creada) n++
  }
  return n
}

/** Al final del día: quién no contactó a nadie teniendo leads. */
async function alertarInactivos(hoy: string): Promise<number> {
  const filas = await db.execute(sql`
    select s.id, u.name,
           (select count(*)::int from lead_assignments la
             where la.setter_id = s.id
               and la.estado in ('asignado', 'abierto', 'saltado')) as sin_contactar
      from setters s
      join users u on u.id = s.user_id
     where u.status = 'activo'
       and not exists (
         select 1 from setter_sends ss
          where ss.setter_id = s.id and ss.ops_date = ${hoy}::date and ss.undone_at is null
       )
  `)

  let n = 0
  for (const f of filas.rows as Array<{ id: string; name: string; sin_contactar: number }>) {
    if (f.sin_contactar === 0) continue
    const creada = await notificarYAvisar(
      {
        tipo: 'setter_inactivo',
        texto: `${f.name} no contactó ninguno de sus ${f.sin_contactar} leads de hoy`,
        enlace: `/equipo/${f.id}`,
        setterId: f.id,
        clave: `inactivo:${f.id}:${hoy}`,
      },
      'Un setter no trabajó hoy',
    )
    if (creada) n++
  }
  return n
}

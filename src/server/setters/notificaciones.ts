import 'server-only'

import { sql } from 'drizzle-orm'

import { db, type Db } from '@/db'
import type { NotificacionTipo } from '@/db/enums'
import {
  NOTIFICACIONES_CONFIG_DEFAULT,
  NOTIFICACIONES_CONFIG_KEY,
  notificacionesConfigSchema,
  type NotificacionesConfig,
} from '@/lib/notificaciones-config'
import { enviarPush } from '@/server/push'

/**
 * La campana del admin.
 *
 * Cada notificación dice **quién, qué y cuándo**, y lleva a la ficha concreta
 * de un click. Una notificación que dice "hay novedades" y te deja buscando no
 * sirve para nada.
 *
 * Sin destinatario, la notificación es para todos los admins: son dos o tres
 * personas mirando la misma operación, y duplicar una fila por cada una solo
 * agrega trabajo para marcarla leída dos veces.
 */

export interface NuevaNotificacion {
  tipo: NotificacionTipo
  texto: string
  enlace?: string | null
  /** null = para todos los admins. */
  paraUsuarioId?: string | null
  setterId?: string | null
  contactId?: string | null
  meetingId?: string | null
  /**
   * Clave de deduplicación. Los avisos que salen de un barrido llevan la fecha
   * adentro, así el mismo aviso no se repite cada vez que alguien abre el
   * tablero.
   */
  clave?: string | null
}

/** Preferencias de avisos. Si nunca se guardaron, valen los defaults. */
export async function leerConfigNotificaciones(): Promise<NotificacionesConfig> {
  const filas = await db.execute(sql`
    select value_jsonb from settings where key = ${NOTIFICACIONES_CONFIG_KEY} limit 1
  `)
  const valor = (filas.rows[0] as { value_jsonb: unknown } | undefined)?.value_jsonb
  if (!valor) return NOTIFICACIONES_CONFIG_DEFAULT

  const parsed = notificacionesConfigSchema.safeParse(valor)
  return parsed.success ? parsed.data : NOTIFICACIONES_CONFIG_DEFAULT
}

/**
 * Deja el aviso en la campana.
 *
 * Devuelve null si el tipo está apagado en la configuración o si la clave ya
 * existía —el aviso ya salió antes—, así los barridos pueden correr cada quince
 * minutos sin repetir nada.
 */
export async function notificar(n: NuevaNotificacion, cliente: Db = db): Promise<string | null> {
  const config = await leerConfigNotificaciones()
  if (!(config[n.tipo]?.campana ?? true)) return null

  const filas = await cliente.execute(sql`
    insert into notificaciones (tipo, para_usuario_id, setter_id, contact_id, meeting_id,
                                texto, enlace, clave)
    values (${n.tipo}, ${n.paraUsuarioId ?? null}::uuid, ${n.setterId ?? null}::uuid,
            ${n.contactId ?? null}::uuid, ${n.meetingId ?? null}::uuid,
            ${n.texto}, ${n.enlace ?? null}, ${n.clave ?? null})
    on conflict do nothing
    returning id
  `)
  return (filas.rows[0] as { id: string } | undefined)?.id ?? null
}

/**
 * Notifica y además manda el push. Se usa para lo que no puede esperar a que
 * alguien mire la pantalla: una respuesta o una reunión recién agendada.
 */
export async function notificarYAvisar(n: NuevaNotificacion, titulo: string): Promise<boolean> {
  // `notificar` ya filtra por la configuración de la campana: si el tipo está
  // apagado, o si la clave ya existía, no hay nada que avisar.
  const id = await notificar(n)
  if (!id) return false

  const config = await leerConfigNotificaciones()
  if (!(config[n.tipo]?.push ?? false)) return true

  const destinatarios = n.paraUsuarioId ? [n.paraUsuarioId] : await idsDeAdmins()

  await enviarPush(destinatarios, {
    titulo,
    cuerpo: n.texto,
    enlace: n.enlace ?? '/equipo',
    etiqueta: n.tipo,
  })
  return true
}

export async function idsDeAdmins(): Promise<string[]> {
  const filas = await db.execute(sql`
    select id from users where role in ('admin_madre', 'admin') and status = 'activo'
  `)
  return (filas.rows as Array<{ id: string }>).map((f) => f.id)
}

export interface FilaNotificacion {
  id: string
  tipo: NotificacionTipo
  texto: string
  enlace: string | null
  leida: boolean
  createdAt: Date
  setterNombre: string | null
}

/** Las últimas notificaciones para la campana. */
export async function listarNotificaciones(
  userId: string,
  limite = 40,
): Promise<{ filas: FilaNotificacion[]; sinLeer: number }> {
  const filas = await db.execute(sql`
    select n.id, n.tipo, n.texto, n.enlace, n.leida, n.created_at,
           u.name as setter_nombre
      from notificaciones n
      left join setters s on s.id = n.setter_id
      left join users u on u.id = s.user_id
     where n.para_usuario_id is null or n.para_usuario_id = ${userId}::uuid
     order by n.created_at desc
     limit ${limite}
  `)

  const sinLeer = await db.execute(sql`
    select count(*)::int as n
      from notificaciones
     where not leida
       and (para_usuario_id is null or para_usuario_id = ${userId}::uuid)
  `)

  return {
    filas: (filas.rows as Array<{
      id: string
      tipo: NotificacionTipo
      texto: string
      enlace: string | null
      leida: boolean
      created_at: Date
      setter_nombre: string | null
    }>).map((f) => ({
      id: f.id,
      tipo: f.tipo,
      texto: f.texto,
      enlace: f.enlace,
      leida: f.leida,
      createdAt: new Date(f.created_at),
      setterNombre: f.setter_nombre,
    })),
    sinLeer: (sinLeer.rows[0] as { n: number } | undefined)?.n ?? 0,
  }
}

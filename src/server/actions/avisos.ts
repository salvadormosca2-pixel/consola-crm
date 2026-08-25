'use server'

import { sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db } from '@/db'
import type { EstadoAccion } from '@/lib/form-state'
import { enviarPush } from '@/server/push'
import { ErrorDePermiso, exigirAdmin } from '@/server/session'
import { contarPendientes, mandarRecordatorio } from '@/server/setters/recordatorios'

/**
 * Recordatorios y mensajes al equipo.
 *
 * Son las dos herramientas que tengo para que las cosas se hagan sin
 * perseguir a nadie por WhatsApp: un aviso con los números exactos, y un
 * mensaje que aparece antes de la cola.
 */

function alFallar(err: unknown, generico: string): EstadoAccion {
  if (err instanceof ErrorDePermiso) return { ok: false, error: err.message }
  console.error(generico, err)
  return { ok: false, error: generico }
}

/* ── Recordatorios ────────────────────────────────────────────────────── */

const tipoSchema = z.enum(['seguimientos', 'sin_contactar'])

export async function recordar(setterId: string, tipo: string): Promise<EstadoAccion> {
  try {
    const sesion = await exigirAdmin()
    const parsed = tipoSchema.safeParse(tipo)
    if (!parsed.success) return { ok: false, error: 'Ese tipo de recordatorio no existe.' }

    const [pendientes] = await contarPendientes(setterId)
    if (!pendientes) return { ok: false, error: 'Ese setter ya no está activo.' }

    const mandado = await mandarRecordatorio({
      pendientes,
      tipo: parsed.data,
      automatico: false,
      enviadoPor: sesion.userId,
    })

    if (!mandado) {
      return {
        ok: false,
        error:
          parsed.data === 'seguimientos'
            ? 'No tiene seguimientos pendientes: está al día.'
            : 'No tiene leads sin contactar.',
      }
    }

    revalidatePath('/equipo/seguimientos')
    revalidatePath(`/equipo/${setterId}`)
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo mandar el recordatorio.')
  }
}

export interface ResultadoLote extends EstadoAccion {
  avisados?: number
}

/** Un solo botón para avisarle a todos los que tienen pendientes. */
export async function recordarATodos(tipo: string): Promise<ResultadoLote> {
  try {
    const sesion = await exigirAdmin()
    const parsed = tipoSchema.safeParse(tipo)
    if (!parsed.success) return { ok: false, error: 'Ese tipo de recordatorio no existe.' }

    const todos = await contarPendientes()
    let avisados = 0
    for (const p of todos) {
      const mandado = await mandarRecordatorio({
        pendientes: p,
        tipo: parsed.data,
        automatico: false,
        enviadoPor: sesion.userId,
      })
      if (mandado) avisados++
    }

    if (avisados === 0) {
      return { ok: false, error: 'No hay nadie atrasado. Están todos al día.' }
    }

    revalidatePath('/equipo/seguimientos')
    return { ok: true, error: null, avisados }
  } catch (err) {
    return alFallar(err, 'No se pudieron mandar los recordatorios.')
  }
}

/* ── Mensajes al equipo ───────────────────────────────────────────────── */

const mensajeSchema = z.object({
  nivel: z.enum(['aviso', 'importante', 'bloqueante']),
  titulo: z.string().trim().min(2, 'Ponele un título.').max(120),
  cuerpo: z.string().trim().min(2, 'Escribí el mensaje.').max(4000),
  textoParaCopiar: z.string().trim().max(4000).optional().nullable(),
  fijado: z.boolean().default(false),
  /** Vacío = a todos los setters activos. */
  destinatarios: z.array(z.string().uuid()).default([]),
})

export interface ResultadoMensaje extends EstadoAccion {
  enviados?: number
}

export async function crearMensajeEquipo(datos: unknown): Promise<ResultadoMensaje> {
  try {
    const sesion = await exigirAdmin()
    const parsed = mensajeSchema.safeParse(datos)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }
    }
    const d = parsed.data

    const destinos = await db.execute(
      d.destinatarios.length > 0
        ? sql`select s.id, u.id as user_id, u.name
                from setters s join users u on u.id = s.user_id
               where u.status = 'activo' and s.id = any(${d.destinatarios}::uuid[])`
        : sql`select s.id, u.id as user_id, u.name
                from setters s join users u on u.id = s.user_id
               where u.status = 'activo'`,
    )

    const filas = destinos.rows as Array<{ id: string; user_id: string; name: string }>
    if (filas.length === 0) return { ok: false, error: 'No hay setters activos a quienes mandarlo.' }

    const mensajeId = await db.transaction(async (tx) => {
      const creados = await tx.execute(sql`
        insert into mensajes_equipo (autor_admin, nivel, titulo, cuerpo, texto_para_copiar, fijado)
        values (${sesion.userId}::uuid, ${d.nivel}::mensaje_equipo_nivel, ${d.titulo}, ${d.cuerpo},
                ${d.textoParaCopiar || null}, ${d.fijado})
        returning id
      `)
      const id = (creados.rows[0] as { id: string }).id

      for (const f of filas) {
        await tx.execute(sql`
          insert into mensajes_destinatarios (mensaje_id, setter_id)
          values (${id}::uuid, ${f.id}::uuid)
          on conflict do nothing
        `)
      }

      await tx.execute(sql`
        insert into events (type, actor_user_id, payload_jsonb)
        values ('mensaje_equipo_enviado', ${sesion.userId}::uuid,
                ${JSON.stringify({ nivel: d.nivel, destinatarios: filas.length })}::jsonb)
      `)

      return id
    })

    await enviarPush(
      filas.map((f) => f.user_id),
      {
        titulo: d.nivel === 'bloqueante' ? 'Mensaje importante del equipo' : 'Aviso del equipo',
        cuerpo: d.titulo,
        enlace: '/avisos',
        etiqueta: `mensaje-${mensajeId}`,
      },
    )

    revalidatePath('/equipo/avisos')
    return { ok: true, error: null, enviados: filas.length }
  } catch (err) {
    return alFallar(err, 'No se pudo mandar el mensaje.')
  }
}

/** Reenvía solo a los que no leyeron: se les vuelve a mostrar al abrir la app. */
export async function reenviarANoLeidos(mensajeId: string): Promise<ResultadoMensaje> {
  try {
    await exigirAdmin()

    const filas = await db.execute(sql`
      select u.id as user_id
        from mensajes_destinatarios md
        join setters s on s.id = md.setter_id
        join users u on u.id = s.user_id
       where md.mensaje_id = ${mensajeId}::uuid and md.leido_at is null and u.status = 'activo'
    `)
    const usuarios = (filas.rows as Array<{ user_id: string }>).map((f) => f.user_id)
    if (usuarios.length === 0) return { ok: false, error: 'Ya lo leyeron todos.' }

    const mensajes = await db.execute(sql`
      select titulo, nivel from mensajes_equipo where id = ${mensajeId}::uuid
    `)
    const m = mensajes.rows[0] as { titulo: string; nivel: string } | undefined

    await enviarPush(usuarios, {
      titulo: 'Te falta leer un aviso',
      cuerpo: m?.titulo ?? 'Tenés un mensaje del equipo sin leer.',
      enlace: '/avisos',
      etiqueta: `mensaje-${mensajeId}`,
    })

    revalidatePath('/equipo/avisos')
    return { ok: true, error: null, enviados: usuarios.length }
  } catch (err) {
    return alFallar(err, 'No se pudo reenviar.')
  }
}

export async function fijarMensaje(mensajeId: string, fijado: boolean): Promise<EstadoAccion> {
  try {
    await exigirAdmin()
    await db.execute(sql`
      update mensajes_equipo set fijado = ${fijado} where id = ${mensajeId}::uuid
    `)
    revalidatePath('/equipo/avisos')
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo cambiar el anuncio.')
  }
}

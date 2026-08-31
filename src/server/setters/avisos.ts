import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'
import type { MensajeNivel, RecordatorioTipo } from '@/db/enums'

/**
 * Lo que el setter ve al abrir la app, antes de la cola de leads.
 *
 * El orden importa y es el de la spec:
 *
 *   1. mensaje bloqueante   — no se cierra sin confirmar; la cola no arranca
 *   2. mensaje importante   — cartel con "Entendido", se puede cerrar
 *   3. recordatorio del admin — el que le mandé desde el control
 *   4. alerta de seguimientos — cuántos le tocan hoy
 *   5. la cola del día
 *
 * Un bloqueante existe para casos como "cambiamos el mensaje de apertura, no
 * uses el anterior": mandar 60 DMs con el guion viejo es peor que perder diez
 * minutos de trabajo.
 */

export interface AvisoParaSetter {
  id: string
  destinatarioId: string
  nivel: MensajeNivel
  titulo: string
  cuerpo: string
  textoParaCopiar: string | null
  fijado: boolean
  createdAt: Date
  leidoAt: Date | null
  respuesta: string | null
  autor: string | null
}

export interface RecordatorioParaSetter {
  id: string
  tipo: RecordatorioTipo
  texto: string
  createdAt: Date
}

export interface PuertaDeEntrada {
  bloqueante: AvisoParaSetter | null
  importantes: AvisoParaSetter[]
  fijados: AvisoParaSetter[]
  recordatorio: RecordatorioParaSetter | null
  sinLeer: number
}

interface FilaAviso {
  id: string
  destinatario_id: string
  nivel: MensajeNivel
  titulo: string
  cuerpo: string
  texto_para_copiar: string | null
  fijado: boolean
  created_at: Date
  leido_at: Date | null
  respuesta: string | null
  autor: string | null
}

function aAviso(f: FilaAviso): AvisoParaSetter {
  return {
    id: f.id,
    destinatarioId: f.destinatario_id,
    nivel: f.nivel,
    titulo: f.titulo,
    cuerpo: f.cuerpo,
    textoParaCopiar: f.texto_para_copiar,
    fijado: f.fijado,
    createdAt: new Date(f.created_at),
    leidoAt: f.leido_at ? new Date(f.leido_at) : null,
    respuesta: f.respuesta,
    autor: f.autor,
  }
}

const SELECT_AVISOS = sql`
  select me.id, md.id as destinatario_id, me.nivel, me.titulo, me.cuerpo,
         me.texto_para_copiar, me.fijado, me.created_at,
         md.leido_at, md.respuesta, u.name as autor
    from mensajes_destinatarios md
    join mensajes_equipo me on me.id = md.mensaje_id
    left join users u on u.id = me.autor_admin
`

/**
 * Los anuncios fijados alcanzan también a quien entró después.
 *
 * Un aviso común es un momento: se manda a los que están y se acabó. Un aviso
 * **fijado** no: es una regla que queda —"el guion de apertura cambió", "los
 * domingos no se manda"—, y por eso se muestra arriba de la cola todos los
 * días en vez de desaparecer al leerlo.
 *
 * Los destinatarios se congelaban al mandarlo, así que un setter que entraba al
 * equipo la semana siguiente no tenía fila y no veía **ninguna** de las reglas
 * vigentes. Nadie se enteraba: para el admin figuraba "leído por 4 de 4",
 * porque el nuevo nunca fue de los cuatro. Justo el caso en que el aviso
 * importa más, que es alguien que todavía no sabe cómo se trabaja acá.
 *
 * Se completa al abrir la app, y solo con los fijados: los avisos viejos que no
 * son regla no tienen por qué reaparecerle a nadie.
 */
async function completarFijados(setterId: string): Promise<void> {
  await db.execute(sql`
    insert into mensajes_destinatarios (mensaje_id, setter_id)
    select me.id, ${setterId}::uuid
      from mensajes_equipo me
     where me.fijado
       and not exists (
         select 1 from mensajes_destinatarios md
          where md.mensaje_id = me.id and md.setter_id = ${setterId}::uuid
       )
    on conflict do nothing
  `)
}

export async function leerPuertaDeEntrada(setterId: string): Promise<PuertaDeEntrada> {
  await completarFijados(setterId)

  const filas = await db.execute(sql`
    ${SELECT_AVISOS}
     where md.setter_id = ${setterId}::uuid
       and (md.leido_at is null or me.fijado)
     order by
       case me.nivel when 'bloqueante' then 0 when 'importante' then 1 else 2 end,
       me.created_at desc
  `)

  const avisos = (filas.rows as unknown as FilaAviso[]).map(aAviso)

  const recordatorios = await db.execute(sql`
    select id, tipo, texto, created_at
      from recordatorios
     where setter_id = ${setterId}::uuid and visto_at is null
     order by created_at desc
     limit 1
  `)

  const r = recordatorios.rows[0] as
    | { id: string; tipo: RecordatorioTipo; texto: string; created_at: Date }
    | undefined

  const sinLeer = await db.execute(sql`
    select count(*)::int as n
      from mensajes_destinatarios
     where setter_id = ${setterId}::uuid and leido_at is null
  `)

  return {
    bloqueante: avisos.find((a) => a.nivel === 'bloqueante' && a.leidoAt === null) ?? null,
    importantes: avisos.filter((a) => a.nivel === 'importante' && a.leidoAt === null),
    fijados: avisos.filter((a) => a.fijado),
    recordatorio: r
      ? { id: r.id, tipo: r.tipo, texto: r.texto, createdAt: new Date(r.created_at) }
      : null,
    sinLeer: (sinLeer.rows[0] as { n: number } | undefined)?.n ?? 0,
  }
}

/** Solo el contador, para el punto rojo de la pestaña Avisos. */
export async function contarAvisosSinLeer(setterId: string): Promise<number> {
  const filas = await db.execute(sql`
    select count(*)::int as n
      from mensajes_destinatarios
     where setter_id = ${setterId}::uuid and leido_at is null
  `)
  return (filas.rows[0] as { n: number } | undefined)?.n ?? 0
}

/** El historial completo de la pestaña Avisos. */
export async function listarAvisos(setterId: string): Promise<AvisoParaSetter[]> {
  const filas = await db.execute(sql`
    ${SELECT_AVISOS}
     where md.setter_id = ${setterId}::uuid
     order by me.created_at desc
     limit 100
  `)
  return (filas.rows as unknown as FilaAviso[]).map(aAviso)
}

/* ── Lado del admin ───────────────────────────────────────────────────── */

export interface MensajeEnviado {
  id: string
  nivel: MensajeNivel
  titulo: string
  cuerpo: string
  textoParaCopiar: string | null
  fijado: boolean
  createdAt: Date
  autor: string | null
  destinatarios: Array<{
    setterId: string
    nombre: string
    leidoAt: Date | null
    respuesta: string | null
    respondidoAt: Date | null
  }>
}

/**
 * Los mensajes que mandé, con quién los leyó y a qué hora.
 *
 * "Leído por 4 de 6" con los nombres es la diferencia entre saber que el
 * equipo se enteró del cambio de guion y suponerlo.
 */
export async function listarMensajesEnviados(limite = 40): Promise<MensajeEnviado[]> {
  const filas = await db.execute(sql`
    select me.id, me.nivel, me.titulo, me.cuerpo, me.texto_para_copiar, me.fijado,
           me.created_at, autor.name as autor,
           md.setter_id, md.leido_at, md.respuesta, md.respondido_at,
           u.name as setter_nombre
      from mensajes_equipo me
      left join users autor on autor.id = me.autor_admin
      left join mensajes_destinatarios md on md.mensaje_id = me.id
      left join setters s on s.id = md.setter_id
      left join users u on u.id = s.user_id
     where me.id in (
       select id from mensajes_equipo order by created_at desc limit ${limite}
     )
     order by me.created_at desc, u.name asc
  `)

  const porMensaje = new Map<string, MensajeEnviado>()

  for (const f of filas.rows as Array<{
    id: string
    nivel: MensajeNivel
    titulo: string
    cuerpo: string
    texto_para_copiar: string | null
    fijado: boolean
    created_at: Date
    autor: string | null
    setter_id: string | null
    leido_at: Date | null
    respuesta: string | null
    respondido_at: Date | null
    setter_nombre: string | null
  }>) {
    let mensaje = porMensaje.get(f.id)
    if (!mensaje) {
      mensaje = {
        id: f.id,
        nivel: f.nivel,
        titulo: f.titulo,
        cuerpo: f.cuerpo,
        textoParaCopiar: f.texto_para_copiar,
        fijado: f.fijado,
        createdAt: new Date(f.created_at),
        autor: f.autor,
        destinatarios: [],
      }
      porMensaje.set(f.id, mensaje)
    }
    if (f.setter_id) {
      mensaje.destinatarios.push({
        setterId: f.setter_id,
        nombre: f.setter_nombre ?? 'Sin nombre',
        leidoAt: f.leido_at ? new Date(f.leido_at) : null,
        respuesta: f.respuesta,
        respondidoAt: f.respondido_at ? new Date(f.respondido_at) : null,
      })
    }
  }

  return [...porMensaje.values()]
}

/** El historial de recordatorios que le mandé, para su propia pantalla. */
export async function listarRecordatorios(setterId: string): Promise<RecordatorioParaSetter[]> {
  const filas = await db.execute(sql`
    select id, tipo, texto, created_at
      from recordatorios
     where setter_id = ${setterId}::uuid
     order by created_at desc
     limit 30
  `)
  return (filas.rows as Array<{
    id: string
    tipo: RecordatorioTipo
    texto: string
    created_at: Date
  }>).map((f) => ({ id: f.id, tipo: f.tipo, texto: f.texto, createdAt: new Date(f.created_at) }))
}

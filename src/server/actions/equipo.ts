'use server'

import { hash } from '@node-rs/argon2'
import { sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db, type Ejecutor } from '@/db'
import { MAXIMO_POR_LOTE, normalizarInstagram } from '@/lib/equipo-lote'
import type { EstadoAccion } from '@/lib/form-state'
import {
  NOTIFICACIONES_CONFIG_KEY,
  notificacionesConfigSchema,
} from '@/lib/notificaciones-config'
import { generarPasswordTemporal, tarjetaDeAcceso } from '@/lib/password'
import { SETTERS_CONFIG_DEFAULT } from '@/lib/setters-config'
import { ErrorDePermiso, exigirAdmin, exigirAdminMadre } from '@/server/session'
import { devolverLead, devolverPendientes, reasignarLead } from '@/server/setters/asignacion'
import { borrarSetter } from '@/server/setters/borrar'
import { proponerReparto, repartirAhora } from '@/server/setters/reparto'

/**
 * Alta, baja y mantenimiento del equipo.
 *
 * Dos niveles de permiso, y la diferencia es deliberada:
 *
 *   · **admin_madre** — todo lo que toca una cuenta de acceso: crearla,
 *     restablecer su contraseña, darla de baja, cambiar un rol. Es lo que
 *     decide quién entra al sistema.
 *   · **admin** — todo lo operativo: pausar, reasignar leads, devolver al pozo,
 *     tomar un lead. Es lo que decide quién trabaja qué.
 *
 * La cuenta madre además está protegida por un disparador en la base: aunque
 * alguien llame a estas acciones con su id, la base rechaza el cambio.
 */

/**
 * Una lista de identificadores para un `in (...)`.
 *
 * Va como lista de parámetros y no como arreglo: pasar un arreglo de JavaScript
 * a `= any(...)` no sobrevive el viaje —Postgres no le encuentra el tipo— y la
 * consulta no falla, devuelve **cero filas**. La operación se da por hecha y no
 * toca nada.
 */
function listaDeIds(ids: string[]) {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )
}

function alFallar(err: unknown, generico: string): EstadoAccion {
  if (err instanceof ErrorDePermiso) return { ok: false, error: err.message }
  console.error(generico, err)
  return { ok: false, error: generico }
}

function refrescarPanel(setterId?: string): void {
  revalidatePath('/equipo')
  revalidatePath('/equipo/seguimientos')
  revalidatePath('/equipo/leads')
  if (setterId) revalidatePath(`/equipo/${setterId}`)
}

/** La URL con la que el setter entra. Sale del pedido, sin configurar nada. */
async function urlDeLaApp(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const protocolo = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${protocolo}://${host}/ingresar`
}

async function hashear(password: string): Promise<string> {
  return hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
}

/* ── Alta ─────────────────────────────────────────────────────────────── */

const cuentaSchema = z.object({
  usuario: z
    .string()
    .trim()
    .min(1, 'Escribí el usuario de Instagram.')
    .max(60)
    .transform((v) => v.replace(/^@/, '').toLowerCase()),
  cupo: z.coerce.number().int().min(1).max(100),
})

const altaSchema = z.object({
  nombre: z.string().trim().min(2, 'Escribí el nombre.').max(80),
  email: z.string().trim().toLowerCase().email('Ese email no tiene formato válido.'),
  tanda: z.coerce.number().int().min(1).max(500),
  cuentas: z.array(cuentaSchema).min(1, 'Cargá al menos una cuenta de Instagram.').max(5),
})

export interface TarjetaDeAlta {
  ok: true
  setterId: string
  nombre: string
  email: string
  password: string
  url: string
  /** El texto completo, listo para copiar y pegar por WhatsApp. */
  tarjeta: string
  /**
   * El mail ya estaba en el sistema, de alguien que había sido dado de baja, y
   * en vez de rebotar el alta se le devolvió la cuenta. Lo dice la pantalla:
   * volvió con su historial, no es una cuenta nueva en blanco.
   */
  reactivado: boolean
}

export type ResultadoAlta = TarjetaDeAlta | { ok: false; error: string }

interface DatosDeAlta {
  nombre: string
  email: string
  tanda: number
  cuentas: Array<{ usuario: string; cupo: number }>
  passwordHash: string
  creadoPor: string
}

/**
 * El alta en sí, adentro de una transacción. Devuelve el id del setter.
 *
 * La comparten el alta de a uno y la de a muchos: es la misma operación con
 * distinta pantalla adelante. Duplicarla es la forma de que dentro de un mes
 * una cree la fila de `setters` y la otra no, y que el que entró por la
 * pantalla equivocada no tenga cola ni cupo y nadie sepa por qué.
 *
 * **Si el mail es de alguien que está de baja, el alta lo devuelve al equipo en
 * vez de rebotar.** Un mail es una persona: dar de baja a alguien y volver a
 * darlo de alta dos meses después es la misma persona volviendo, y el sistema
 * decía "ya hay una cuenta con ese email" sin decir de quién ni cómo seguir.
 * Quedaba un callejón sin salida: el mail estaba ocupado por una fila que no se
 * veía en ninguna pantalla. Vuelve con su historial y su comisión intactos y
 * con contraseña nueva, que es exactamente lo que se quería.
 */
async function altaDeSetter(
  tx: Ejecutor,
  datos: DatosDeAlta,
): Promise<{ id: string; reactivado: boolean }> {
  const previas = await tx.execute(sql`
    select u.id, u.role, u.status, s.id as setter_id
      from users u
      left join setters s on s.user_id = u.id
     where lower(u.email) = ${datos.email}
     limit 1
  `)
  const previo = previas.rows[0] as
    | { id: string; role: string; status: string; setter_id: string | null }
    | undefined

  if (previo) {
    // Activo o pausado sigue siendo un choque de verdad: esa persona trabaja
    // acá. Y una cuenta de admin no se convierte en setter por dar un alta —
    // eso sería cambiarle el rol a quien reparte los leads sin decirlo.
    if (previo.status !== 'baja' || previo.role !== 'setter') throw new Error('EMAIL_REPETIDO')
    return { id: await reactivarEnElAlta(tx, datos, previo), reactivado: true }
  }

  const usuarios = await tx.execute(sql`
    insert into users (email, name, password_hash, role, status,
                       must_change_password, created_by, sessions_valid_from)
    values (${datos.email}, ${datos.nombre}, ${datos.passwordHash}, 'setter', 'activo',
            true, ${datos.creadoPor}::uuid, now())
    returning id
  `)
  const userId = (usuarios.rows[0] as { id: string }).id

  /*
   * Cada setter recibe una variante distinta del mensaje de apertura. Se
   * reparten por orden de alta: mil DMs con el mismo texto exacto es lo
   * que dispara las restricciones de Instagram.
   */
  const cuantos = await tx.execute(sql`select count(*)::int as n from setters`)
  const variante = (cuantos.rows[0] as { n: number }).n

  const filas = await tx.execute(sql`
    insert into setters (user_id, tanda_diaria, variante, hora_recordatorio)
    values (${userId}::uuid, ${datos.tanda}, ${variante},
            ${SETTERS_CONFIG_DEFAULT.horaRecordatorioDefault}::time)
    returning id
  `)
  const id = (filas.rows[0] as { id: string }).id

  for (const [i, cuenta] of datos.cuentas.entries()) {
    await tx.execute(sql`
      insert into setter_accounts (setter_id, ig_username, cupo_diario, orden)
      values (${id}::uuid, ${cuenta.usuario}, ${cuenta.cupo}, ${i + 1})
    `)
  }

  await tx.execute(sql`
    insert into events (type, actor_user_id, payload_jsonb)
    values ('setter_creado', ${datos.creadoPor}::uuid,
            ${JSON.stringify({
              nombre: datos.nombre,
              email: datos.email,
              cuentas: datos.cuentas.length,
            })}::jsonb)
  `)

  return { id, reactivado: false }
}

/**
 * Devolverle la cuenta a alguien que estaba de baja.
 *
 * No se borra ni se rehace nada: es la misma fila de siempre, así que sus
 * mensajes, sus reuniones y su comisión quedan donde estaban. Lo que cambia es
 * lo que hace falta para que pueda volver a entrar —contraseña nueva, que la
 * tiene que cambiar al primer ingreso, y las sesiones viejas invalidadas— más
 * el nombre y la tanda de este alta, por si se corrigió algo.
 */
async function reactivarEnElAlta(
  tx: Ejecutor,
  datos: DatosDeAlta,
  previo: { id: string; setter_id: string | null },
): Promise<string> {
  await tx.execute(sql`
    update users
       set name = ${datos.nombre},
           password_hash = ${datos.passwordHash},
           status = 'activo',
           must_change_password = true,
           failed_attempts = 0,
           locked_until = null,
           sessions_valid_from = now()
     where id = ${previo.id}::uuid
  `)

  let setterId = previo.setter_id
  if (setterId) {
    await tx.execute(sql`
      update setters set tanda_diaria = ${datos.tanda} where id = ${setterId}::uuid
    `)
  } else {
    const cuantos = await tx.execute(sql`select count(*)::int as n from setters`)
    const filas = await tx.execute(sql`
      insert into setters (user_id, tanda_diaria, variante, hora_recordatorio)
      values (${previo.id}::uuid, ${datos.tanda}, ${(cuantos.rows[0] as { n: number }).n},
              ${SETTERS_CONFIG_DEFAULT.horaRecordatorioDefault}::time)
      returning id
    `)
    setterId = (filas.rows[0] as { id: string }).id
  }

  // Las cuentas de Instagram que ya tenía siguen siendo suyas: se agregan solo
  // las que falten. Sin el `where not exists`, volver a cargar la misma cuenta
  // de siempre choca contra el índice único y tira abajo el alta entera.
  const maximo = await tx.execute(sql`
    select coalesce(max(orden), 0)::int as n from setter_accounts
     where setter_id = ${setterId}::uuid
  `)
  let orden = (maximo.rows[0] as { n: number }).n

  for (const cuenta of datos.cuentas) {
    orden++
    await tx.execute(sql`
      insert into setter_accounts (setter_id, ig_username, cupo_diario, orden)
      select ${setterId}::uuid, ${cuenta.usuario}, ${cuenta.cupo}, ${orden}
       where not exists (
         select 1 from setter_accounts
          where setter_id = ${setterId}::uuid and lower(ig_username) = lower(${cuenta.usuario})
       )
    `)
  }

  await tx.execute(sql`
    insert into events (type, actor_user_id, payload_jsonb)
    values ('setter_reactivado', ${datos.creadoPor}::uuid,
            ${JSON.stringify({
              setterId,
              nombre: datos.nombre,
              email: datos.email,
              desdeElAlta: true,
            })}::jsonb)
  `)

  return setterId
}

/**
 * Crea un setter y devuelve su tarjeta de acceso.
 *
 * La contraseña temporal **se ve una sola vez**: se guarda con hash y no se
 * puede recuperar. Si se pierde, se genera otra. Es la única forma de que
 * "guardada con hash" signifique algo.
 */
export async function crearSetter(datos: unknown): Promise<ResultadoAlta> {
  try {
    const sesion = await exigirAdminMadre()
    const parsed = altaSchema.safeParse(datos)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }
    }

    const { nombre, email, tanda, cuentas } = parsed.data
    const usuarios = cuentas.map((c) => c.usuario)
    if (new Set(usuarios).size !== usuarios.length) {
      return { ok: false, error: 'Repetiste una cuenta de Instagram.' }
    }

    const password = generarPasswordTemporal()
    const passwordHash = await hashear(password)
    const url = await urlDeLaApp()

    const alta = await db.transaction((tx) =>
      altaDeSetter(tx, { nombre, email, tanda, cuentas, passwordHash, creadoPor: sesion.userId }),
    )

    refrescarPanel()
    return {
      ok: true,
      setterId: alta.id,
      nombre,
      email,
      password,
      url,
      tarjeta: tarjetaDeAcceso({ nombre, email, password, url }),
      reactivado: alta.reactivado,
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'EMAIL_REPETIDO') {
      return {
        ok: false,
        error: 'Ese email ya lo usa alguien del equipo. Si es la misma persona, entrá a su ficha.',
      }
    }
    if (
      err instanceof Error &&
      /setter_accounts_ig_uq/.test((err as { message?: string }).message ?? '')
    ) {
      return { ok: false, error: 'Alguna de esas cuentas de Instagram ya está cargada.' }
    }
    const r = alFallar(err, 'No se pudo crear el setter.')
    return { ok: false, error: r.error ?? 'No se pudo crear el setter.' }
  }
}

/* ── Alta en lote ─────────────────────────────────────────────────────── */

const loteSchema = z.object({
  tanda: z.coerce.number().int().min(1).max(500),
  cupo: z.coerce.number().int().min(1).max(100),
  setters: z
    .array(
      z.object({
        nombre: z.string().trim().min(2, 'Hay alguien sin nombre en la lista.').max(80),
        email: z.string().trim().toLowerCase().email('Hay un email con formato inválido.'),
        /** Opcional: el que no la tenga entra igual y se le carga después. */
        instagram: z
          .string()
          .max(60)
          .default('')
          .transform((v) => normalizarInstagram(v)),
      }),
    )
    .min(1, 'La lista está vacía.')
    .max(MAXIMO_POR_LOTE, `No más de ${MAXIMO_POR_LOTE} por tanda.`),
})

export interface ResultadoLote {
  ok: true
  creados: TarjetaDeAlta[]
  /** Los que no se crearon, con el motivo. Ninguno se pierde en silencio. */
  omitidos: Array<{ email: string; motivo: string }>
}

/**
 * Da de alta a varios setters de una, con la tarjeta de acceso de cada uno.
 *
 * Sin cuentas de Instagram: entran para poder ingresar y cambiar su
 * contraseña, y la cuenta con la que va a trabajar cada uno se le carga después
 * desde su ficha. Mientras no tenga ninguna, su cupo es cero y el reparto no le
 * entrega nada — no es que quede a medio crear, es que todavía no tiene con qué
 * mandar.
 *
 * Cada uno va en **su propia transacción**, y esa es la decisión importante:
 * con una sola para las dieciséis, un mail repetido en la línea nueve tira
 * abajo las ocho altas anteriores, y las ocho contraseñas que ya se habían
 * mostrado en pantalla dejan de existir sin que nadie se entere. Así, el que
 * falla es el único que falla y vuelve con su motivo.
 */
export async function crearSettersEnLote(
  datos: unknown,
): Promise<ResultadoLote | { ok: false; error: string }> {
  try {
    const sesion = await exigirAdminMadre()
    const parsed = loteSchema.safeParse(datos)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá la lista.' }
    }

    const { tanda, cupo, setters } = parsed.data
    const url = await urlDeLaApp()

    const creados: TarjetaDeAlta[] = []
    const omitidos: Array<{ email: string; motivo: string }> = []
    const vistos = new Set<string>()
    const cuentasVistas = new Set<string>()

    for (const { nombre, email, instagram } of setters) {
      if (vistos.has(email)) {
        omitidos.push({ email, motivo: 'Estaba repetido en la lista.' })
        continue
      }
      vistos.add(email)

      if (instagram && cuentasVistas.has(instagram)) {
        omitidos.push({ email, motivo: `La cuenta @${instagram} estaba repetida en la lista.` })
        continue
      }
      if (instagram) cuentasVistas.add(instagram)

      const password = generarPasswordTemporal()
      const passwordHash = await hashear(password)

      try {
        const alta = await db.transaction((tx) =>
          altaDeSetter(tx, {
            nombre,
            email,
            tanda,
            cuentas: instagram ? [{ usuario: instagram, cupo }] : [],
            passwordHash,
            creadoPor: sesion.userId,
          }),
        )
        creados.push({
          ok: true,
          setterId: alta.id,
          nombre,
          email,
          password,
          url,
          tarjeta: tarjetaDeAcceso({ nombre, email, password, url }),
          reactivado: alta.reactivado,
        })
      } catch (err) {
        if (err instanceof Error && err.message === 'EMAIL_REPETIDO') {
          omitidos.push({ email, motivo: 'Ya tiene una cuenta activa en el sistema.' })
        } else if (/setter_accounts_ig_uq/.test((err as { message?: string }).message ?? '')) {
          // El alta entera se deshizo con la transacción: no quedó a medias.
          omitidos.push({ email, motivo: `La cuenta @${instagram} ya está cargada en otro setter.` })
        } else {
          console.error('No se pudo crear un setter del lote.', err)
          omitidos.push({ email, motivo: 'Falló el alta. Probá de nuevo con este solo.' })
        }
      }
    }

    refrescarPanel()
    return { ok: true, creados, omitidos }
  } catch (err) {
    const r = alFallar(err, 'No se pudo dar de alta al equipo.')
    return { ok: false, error: r.error ?? 'No se pudo dar de alta al equipo.' }
  }
}

export type ResultadoRestablecer =
  | { ok: true; nombre: string; email: string; password: string; url: string; tarjeta: string }
  | { ok: false; error: string }

/**
 * Contraseña nueva en un click, con la misma tarjeta para reenviar. Es lo que
 * va a pasar seguido, así que tiene que ser rápido.
 */
export async function restablecerPassword(setterId: string): Promise<ResultadoRestablecer> {
  try {
    const sesion = await exigirAdminMadre()

    const filas = await db.execute(sql`
      select u.id, u.name, u.email from setters s join users u on u.id = s.user_id
       where s.id = ${setterId}::uuid limit 1
    `)
    const u = filas.rows[0] as { id: string; name: string; email: string } | undefined
    if (!u) return { ok: false, error: 'Ese setter ya no existe.' }

    const password = generarPasswordTemporal()
    const passwordHash = await hashear(password)
    const url = await urlDeLaApp()

    await db.transaction(async (tx) => {
      await tx.execute(sql`
        update users
           set password_hash = ${passwordHash}, must_change_password = true,
               failed_attempts = 0, locked_until = null,
               -- Restablecer también cierra las sesiones abiertas: si alguien
               -- se metió con la contraseña vieja, deja de estar adentro.
               sessions_valid_from = now()
         where id = ${u.id}::uuid
      `)
      await tx.execute(sql`
        insert into events (type, actor_user_id, payload_jsonb)
        values ('password_restablecida', ${sesion.userId}::uuid,
                ${JSON.stringify({ setterId })}::jsonb)
      `)
    })

    refrescarPanel(setterId)
    return {
      ok: true,
      nombre: u.name,
      email: u.email,
      password,
      url,
      tarjeta: tarjetaDeAcceso({ nombre: u.name, email: u.email, password, url }),
    }
  } catch (err) {
    const r = alFallar(err, 'No se pudo restablecer la contraseña.')
    return { ok: false, error: r.error ?? 'No se pudo restablecer la contraseña.' }
  }
}

/* ── Edición ──────────────────────────────────────────────────────────── */

const edicionSchema = z.object({
  setterId: z.string().uuid(),
  nombre: z.string().trim().min(2).max(80),
  tanda: z.coerce.number().int().min(1).max(500),
  recordatorioAutomatico: z.boolean(),
  horaRecordatorio: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  cuentas: z
    .array(
      cuentaSchema.extend({
        id: z.string().uuid().nullable(),
        activa: z.boolean(),
      }),
    )
    .max(5),
})

export async function guardarSetter(datos: unknown): Promise<EstadoAccion> {
  try {
    const sesion = await exigirAdmin()
    const parsed = edicionSchema.safeParse(datos)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }
    }
    const d = parsed.data

    await db.transaction(async (tx) => {
      const filas = await tx.execute(sql`
        select user_id from setters where id = ${d.setterId}::uuid limit 1
      `)
      const userId = (filas.rows[0] as { user_id: string } | undefined)?.user_id
      if (!userId) throw new Error('NO_EXISTE')

      await tx.execute(sql`update users set name = ${d.nombre} where id = ${userId}::uuid`)
      await tx.execute(sql`
        update setters
           set tanda_diaria = ${d.tanda},
               recordatorio_automatico = ${d.recordatorioAutomatico},
               hora_recordatorio = ${d.horaRecordatorio}::time
         where id = ${d.setterId}::uuid
      `)

      for (const [i, cuenta] of d.cuentas.entries()) {
        if (cuenta.id) {
          await tx.execute(sql`
            update setter_accounts
               set ig_username = ${cuenta.usuario}, cupo_diario = ${cuenta.cupo},
                   activa = ${cuenta.activa}, orden = ${i + 1}
             where id = ${cuenta.id}::uuid and setter_id = ${d.setterId}::uuid
          `)
        } else {
          await tx.execute(sql`
            insert into setter_accounts (setter_id, ig_username, cupo_diario, orden, activa)
            values (${d.setterId}::uuid, ${cuenta.usuario}, ${cuenta.cupo}, ${i + 1}, ${cuenta.activa})
          `)
        }
      }

      await tx.execute(sql`
        insert into events (type, actor_user_id, payload_jsonb)
        values ('setter_editado', ${sesion.userId}::uuid,
                ${JSON.stringify({ setterId: d.setterId })}::jsonb)
      `)
    })

    refrescarPanel(d.setterId)
    return { ok: true, error: null }
  } catch (err) {
    if (err instanceof Error && err.message === 'NO_EXISTE') {
      return { ok: false, error: 'Ese setter ya no existe.' }
    }
    if (/setter_accounts_ig_uq/.test((err as { message?: string }).message ?? '')) {
      return { ok: false, error: 'Esa cuenta de Instagram ya está cargada en otro setter.' }
    }
    return alFallar(err, 'No se pudieron guardar los cambios.')
  }
}

/* ── Solo las cuentas de Instagram ────────────────────────────────────── */

const instagramSchema = z.object({
  setterId: z.string().uuid(),
  cuentas: z
    .array(cuentaSchema.extend({ id: z.string().uuid().nullable(), activa: z.boolean() }))
    .max(5, 'Cinco cuentas por setter es el tope.'),
})

/**
 * Guarda las cuentas de Instagram de un setter y **nada más**.
 *
 * Existe separada de `guardarSetter` porque es otra tarea: aquella es "editar a
 * esta persona" —nombre, tanda, recordatorio, todo junto— y esta es "cargar con
 * qué cuenta trabaja el equipo", que es lo que hay que hacer dieciséis veces
 * seguidas después de un alta en lote. Mandar el resto de los campos en cada
 * guardado es abrir la puerta a pisar un nombre o una tanda sin querer, en una
 * pantalla donde nadie los estaba mirando.
 *
 * La cuenta que se saca **se apaga, no se borra**: `setter_sends` la referencia
 * con `on delete restrict`, y borrarla sería perder de qué cuenta salió cada
 * mensaje que ya se mandó. Apagada deja de contar para el cupo y de recibir
 * reparto, que es lo que se quería.
 */
export async function guardarInstagram(datos: unknown): Promise<EstadoAccion> {
  try {
    const sesion = await exigirAdmin()
    const parsed = instagramSchema.safeParse(datos)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá las cuentas.' }
    }
    const { setterId, cuentas } = parsed.data

    const usuarios = cuentas.map((c) => c.usuario)
    if (new Set(usuarios).size !== usuarios.length) {
      return { ok: false, error: 'Repetiste una cuenta de Instagram.' }
    }

    await db.transaction(async (tx) => {
      const filas = await tx.execute(sql`
        select 1 from setters where id = ${setterId}::uuid limit 1
      `)
      if (filas.rows.length === 0) throw new Error('NO_EXISTE')

      const conservadas = cuentas.map((c) => c.id).filter((id): id is string => id !== null)

      // Las que estaban y ya no vienen en la pantalla: apagadas, no borradas.
      await tx.execute(sql`
        update setter_accounts set activa = false
         where setter_id = ${setterId}::uuid and activa
           ${
             conservadas.length > 0
               ? sql`and id not in (${listaDeIds(conservadas)})`
               : sql``
           }
      `)

      for (const [i, cuenta] of cuentas.entries()) {
        if (cuenta.id) {
          await tx.execute(sql`
            update setter_accounts
               set ig_username = ${cuenta.usuario}, cupo_diario = ${cuenta.cupo},
                   activa = ${cuenta.activa}, orden = ${i + 1}
             where id = ${cuenta.id}::uuid and setter_id = ${setterId}::uuid
          `)
        } else {
          await tx.execute(sql`
            insert into setter_accounts (setter_id, ig_username, cupo_diario, orden, activa)
            values (${setterId}::uuid, ${cuenta.usuario}, ${cuenta.cupo}, ${i + 1}, ${cuenta.activa})
          `)
        }
      }

      await tx.execute(sql`
        insert into events (type, actor_user_id, payload_jsonb)
        values ('setter_editado', ${sesion.userId}::uuid,
                ${JSON.stringify({ setterId, cuentas: cuentas.length })}::jsonb)
      `)
    })

    refrescarPanel(setterId)
    revalidatePath('/equipo/instagram')
    return { ok: true, error: null }
  } catch (err) {
    if (err instanceof Error && err.message === 'NO_EXISTE') {
      return { ok: false, error: 'Ese setter ya no existe.' }
    }
    if (/setter_accounts_ig_uq/.test((err as { message?: string }).message ?? '')) {
      return { ok: false, error: 'Esa cuenta de Instagram ya está cargada en otro setter.' }
    }
    return alFallar(err, 'No se pudieron guardar las cuentas.')
  }
}

/* ── Pausar, reactivar, dar de baja ───────────────────────────────────── */

/**
 * Pausar: deja de recibir leads nuevos, sus pendientes vuelven al pozo, y no
 * puede entrar. Conserva el historial y la atribución de comisión.
 */
export async function pausarSetter(setterId: string): Promise<EstadoAccion> {
  try {
    const sesion = await exigirAdmin()
    const userId = await usuarioDelSetter(setterId)
    if (!userId) return { ok: false, error: 'Ese setter ya no existe.' }

    await db.execute(sql`update users set status = 'pausado' where id = ${userId}::uuid`)
    const devueltos = await devolverPendientes(
      setterId,
      'El setter quedó pausado.',
      sesion.userId,
    )
    await db.execute(sql`
      insert into events (type, actor_user_id, payload_jsonb)
      values ('setter_pausado', ${sesion.userId}::uuid,
              ${JSON.stringify({ setterId, devueltos })}::jsonb)
    `)

    refrescarPanel(setterId)
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo pausar.')
  }
}

export async function reactivarSetter(setterId: string): Promise<EstadoAccion> {
  try {
    const sesion = await exigirAdmin()
    const userId = await usuarioDelSetter(setterId)
    if (!userId) return { ok: false, error: 'Ese setter ya no existe.' }

    await db.execute(sql`update users set status = 'activo' where id = ${userId}::uuid`)
    await db.execute(sql`
      insert into events (type, actor_user_id, payload_jsonb)
      values ('setter_reactivado', ${sesion.userId}::uuid, ${JSON.stringify({ setterId })}::jsonb)
    `)
    refrescarPanel(setterId)
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo reactivar.')
  }
}

/**
 * Dar de baja.
 *
 * No borra el registro: lo desactiva. Los leads sin contactar vuelven al pozo
 * solos, y el historial y la atribución quedan intactos para poder liquidar lo
 * que ya trabajó. Borrar la fila sería perder de quién fue cada venta.
 */
export async function darDeBaja(setterId: string): Promise<EstadoAccion> {
  try {
    const sesion = await exigirAdminMadre()
    const userId = await usuarioDelSetter(setterId)
    if (!userId) return { ok: false, error: 'Ese setter ya no existe.' }

    await db.execute(sql`
      update users set status = 'baja', sessions_valid_from = now() where id = ${userId}::uuid
    `)
    const devueltos = await devolverPendientes(
      setterId,
      'El setter fue dado de baja.',
      sesion.userId,
    )
    await db.execute(sql`
      insert into events (type, actor_user_id, payload_jsonb)
      values ('setter_baja', ${sesion.userId}::uuid,
              ${JSON.stringify({ setterId, devueltos })}::jsonb)
    `)

    refrescarPanel(setterId)
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo dar de baja.')
  }
}

/** Por si pierde el celular: se cierran todas sus sesiones abiertas. */
export async function cerrarSesiones(setterId: string): Promise<EstadoAccion> {
  try {
    const sesion = await exigirAdmin()
    const userId = await usuarioDelSetter(setterId)
    if (!userId) return { ok: false, error: 'Ese setter ya no existe.' }

    await db.execute(sql`update users set sessions_valid_from = now() where id = ${userId}::uuid`)
    await db.execute(sql`
      insert into events (type, actor_user_id, payload_jsonb)
      values ('sesiones_cerradas', ${sesion.userId}::uuid, ${JSON.stringify({ setterId })}::jsonb)
    `)
    refrescarPanel(setterId)
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudieron cerrar las sesiones.')
  }
}

/**
 * Borrar un alta equivocada.
 *
 * Es la contracara de la baja, no un atajo para lo mismo: acá la fila
 * desaparece. Por eso solo sale con el que nunca trabajó —la regla la aplica
 * `borrarSetter`, que se niega en cuanto hay un mensaje, una reunión o una
 * respuesta— y por eso el que ya trabajó recibe un error que dice qué hacer en
 * vez de un "no se pudo".
 */
export async function eliminarSetter(setterId: string): Promise<EstadoAccion> {
  try {
    const sesion = await exigirAdminMadre()
    const r = await borrarSetter(setterId, sesion.userId)
    if (!r.ok) return { ok: false, error: r.error }

    refrescarPanel(setterId)
    revalidatePath('/equipo/instagram')
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo eliminar.')
  }
}

async function usuarioDelSetter(setterId: string): Promise<string | null> {
  const filas = await db.execute(sql`
    select user_id from setters where id = ${setterId}::uuid limit 1
  `)
  return (filas.rows[0] as { user_id: string } | undefined)?.user_id ?? null
}

/* ── Leads: reasignar, devolver, tomar ────────────────────────────────── */

export async function reasignar(assignmentId: string, destinoId: string): Promise<EstadoAccion> {
  try {
    const sesion = await exigirAdmin()
    const r = await reasignarLead(assignmentId, destinoId, sesion.userId)
    if (!r.ok) return { ok: false, error: r.error ?? 'No se pudo reasignar.' }
    refrescarPanel()
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo reasignar.')
  }
}

export async function devolverAlPozo(assignmentId: string): Promise<EstadoAccion> {
  try {
    const sesion = await exigirAdmin()
    const ok = await devolverLead(assignmentId, 'Devuelto al pozo a mano.', sesion.userId)
    if (!ok) return { ok: false, error: 'Ese lead ya no está sin trabajar.' }
    refrescarPanel()
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo devolver al pozo.')
  }
}

/**
 * Tomar un lead yo mismo: sale de la cola del setter y pasa a la mía. El
 * contacto queda en el Despachador, con su canal de Instagram.
 */
export async function tomarLead(assignmentId: string): Promise<EstadoAccion> {
  try {
    const sesion = await exigirAdmin()

    const filas = await db.execute(sql`
      update lead_assignments
         set estado = 'devuelto', devuelto_at = now(),
             devuelto_motivo = 'Lo tomó el administrador.',
             marcado_por = ${sesion.userId}::uuid
       where id = ${assignmentId}::uuid and estado not in ('vencido', 'devuelto')
      returning contact_id, setter_id
    `)
    const f = filas.rows[0] as { contact_id: string; setter_id: string } | undefined
    if (!f) return { ok: false, error: 'Ese lead ya no está asignado.' }

    /*
     * Pasa a la cola del Despachador: se lo marca como cliente propio para que
     * salga del pozo de los setters y entre al circuito normal.
     */
    await db.execute(sql`
      update contacts set origen = 'cliente', updated_at = now()
       where id = ${f.contact_id}::uuid
    `)

    await db.execute(sql`
      insert into events (type, contact_id, actor_user_id, payload_jsonb)
      values ('lead_tomado_por_admin', ${f.contact_id}::uuid, ${sesion.userId}::uuid,
              ${JSON.stringify({ setterId: f.setter_id })}::jsonb)
    `)

    refrescarPanel()
    revalidatePath('/despachador')
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo tomar el lead.')
  }
}

/* ── Roles ────────────────────────────────────────────────────────────── */

const rolSchema = z.enum(['admin', 'setter'])

/**
 * Convertir a alguien en admin. Solo la cuenta madre puede, y la cuenta madre
 * misma no se puede degradar: lo impide un disparador en la base.
 */
export async function cambiarRol(userId: string, rol: string): Promise<EstadoAccion> {
  try {
    const sesion = await exigirAdminMadre()
    const parsed = rolSchema.safeParse(rol)
    if (!parsed.success) return { ok: false, error: 'Ese rol no existe.' }

    if (userId === sesion.userId) {
      return { ok: false, error: 'No podés cambiarte el rol a vos mismo.' }
    }

    await db.execute(sql`
      update users set role = ${parsed.data}::user_role where id = ${userId}::uuid
    `)
    await db.execute(sql`
      insert into events (type, actor_user_id, payload_jsonb)
      values ('setter_editado', ${sesion.userId}::uuid,
              ${JSON.stringify({ userId, rol: parsed.data })}::jsonb)
    `)
    refrescarPanel()
    return { ok: true, error: null }
  } catch (err) {
    if (/admin madre/i.test((err as { message?: string }).message ?? '')) {
      return { ok: false, error: 'La cuenta principal no se puede degradar.' }
    }
    return alFallar(err, 'No se pudo cambiar el rol.')
  }
}

/* ── Reparto del pozo ─────────────────────────────────────────────────── */

export interface ResultadoDeReparto extends EstadoAccion {
  entregados?: number
  porSetter?: Array<{ nombre: string; cantidad: number }>
  pozoRestante?: number
}

/**
 * Reparte los leads del pozo entre los setters, respetando el cupo de cada uno.
 *
 * Es lo que se aprieta después de importar una lista: entrega hasta donde
 * llegan las cuentas de cada uno y deja el resto en el pozo para mañana.
 */
export async function repartirLeads(): Promise<ResultadoDeReparto> {
  try {
    const sesion = await exigirAdmin()
    const r = await repartirAhora(sesion.userId)

    /*
     * Un cero no se explica con un "o esto o lo otro": el sistema sabe cuál de
     * las dos cosas pasó, y decirlo es la diferencia entre "está roto" y "me
     * falta cargar las cuentas de Instagram".
     */
    if (r.entregados === 0) {
      const plan = await proponerReparto()
      const sinCuentas = plan.tajadas.filter((t) => t.motivo.includes('cuenta de Instagram')).length

      return {
        ok: false,
        error:
          plan.pozo === 0
            ? 'No quedan leads sin asignar en el pozo. Importá una lista de leads scrapeados.'
            : sinCuentas === plan.tajadas.length && sinCuentas > 0
              ? 'Nadie tiene cuenta de Instagram cargada: cargalas en Equipo → Cuentas de Instagram.'
              : sinCuentas > 0
                ? `Hay ${plan.pozo} leads esperando, pero nadie tiene cupo hoy y ${sinCuentas} no tienen cuenta de Instagram cargada.`
                : 'Hay leads en el pozo, pero hoy nadie tiene cupo libre: ya llegaron a su tanda o al límite de sus cuentas.',
      }
    }

    refrescarPanel()
    return { ok: true, error: null, ...r }
  } catch (err) {
    return alFallar(err, 'No se pudieron repartir los leads.')
  }
}

/* ── Recuperar los que nunca contestaron ──────────────────────────────── */

export interface ResultadoRecuperar extends EstadoAccion {
  recuperados?: number
}

/**
 * Devuelve al pozo leads que recibieron los dos mensajes y nunca contestaron.
 *
 * No es lo mismo que un "no": un "no" es alguien que vio la oferta y dijo que
 * no. Estos nunca dijeron nada — se les pasó, no estaban, no era el momento. En
 * un mes vuelven a ser leads.
 *
 * Vuelven al pozo como si fueran nuevos y se reparten de cero, así que les
 * puede tocar otro setter y arrancan otra vez por el mensaje de entrada. El
 * historial de lo que ya se les mandó queda intacto en la asignación vieja.
 */
export async function recuperarLeads(ids: string[]): Promise<ResultadoRecuperar> {
  try {
    const sesion = await exigirAdmin()

    const validos = ids.filter((i) => z.string().uuid().safeParse(i).success)
    if (validos.length === 0) return { ok: false, error: 'No elegiste ninguno.' }

    const recuperados = await db.transaction(async (tx) => {
      const filas = await tx.execute(sql`
        update lead_assignments
           set estado = 'devuelto', devuelto_at = now(),
               devuelto_motivo = 'Nunca contestó: se recupera para volver a intentar.',
               marcado_por = ${sesion.userId}::uuid
         where id in (${listaDeIds(validos)})
           and estado = 'segundo_enviado'
           and respondido_at is null
        returning contact_id
      `)

      const contactos = (filas.rows as Array<{ contact_id: string }>).map((f) => f.contact_id)
      if (contactos.length === 0) return 0

      /*
       * El contacto vuelve a 'nuevo' para poder entrar de nuevo al pozo, pero
       * `sent_count` no se toca: es el registro de que ya recibió dos mensajes,
       * y sirve para no volver a intentarlo eternamente.
       */
      await tx.execute(sql`
        update contacts
           set stage = 'nuevo', next_followup_at = null, updated_at = now()
         where id in (${listaDeIds(contactos)})
      `)

      await tx.execute(sql`
        insert into events (type, actor_user_id, payload_jsonb)
        values ('lead_devuelto', ${sesion.userId}::uuid,
                ${JSON.stringify({ recuperados: contactos.length, motivo: 'nunca_contesto' })}::jsonb)
      `)

      return contactos.length
    })

    if (recuperados === 0) {
      return { ok: false, error: 'Ninguno de esos se puede recuperar: revisá que sigan sin respuesta.' }
    }

    refrescarPanel()
    return { ok: true, error: null, recuperados }
  } catch (err) {
    return alFallar(err, 'No se pudieron recuperar los leads.')
  }
}

/* ── Notificaciones ───────────────────────────────────────────────────── */

/**
 * Qué avisos quiero y por dónde. Se guarda entero: es una sola fila de
 * `settings` y sobrescribirla es más simple que llevar parches por tipo.
 */
export async function guardarAvisosQueQuiero(datos: unknown): Promise<EstadoAccion> {
  try {
    await exigirAdmin()
    const parsed = notificacionesConfigSchema.safeParse(datos)
    if (!parsed.success) return { ok: false, error: 'Esa configuración no es válida.' }

    await db.execute(sql`
      insert into settings (key, value_jsonb, updated_at)
      values (${NOTIFICACIONES_CONFIG_KEY}, ${JSON.stringify(parsed.data)}::jsonb, now())
      on conflict (key) do update
        set value_jsonb = excluded.value_jsonb, updated_at = now()
    `)

    revalidatePath('/equipo')
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudieron guardar los avisos.')
  }
}

export async function marcarNotificacionesLeidas(ids?: string[]): Promise<EstadoAccion> {
  try {
    const sesion = await exigirAdmin()
    if (ids && ids.length > 0) {
      const validos = ids.filter((i) => z.string().uuid().safeParse(i).success)
      if (validos.length === 0) return { ok: true, error: null }
      await db.execute(sql`
        update notificaciones set leida = true
         where id in (${listaDeIds(validos)})
           and (para_usuario_id is null or para_usuario_id = ${sesion.userId}::uuid)
      `)
    } else {
      await db.execute(sql`
        update notificaciones set leida = true
         where not leida and (para_usuario_id is null or para_usuario_id = ${sesion.userId}::uuid)
      `)
    }
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudieron marcar como leídas.')
  }
}

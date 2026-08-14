'use server'

import { eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { auth } from '@/auth'
import { db } from '@/db'
import type { AccountStatus } from '@/db/enums'
import { contacts, events, messagingAccounts } from '@/db/schema'
import type { EstadoAccion, EstadoFormulario } from '@/lib/form-state'
import { opsDate } from '@/lib/tz'
import { accountSchema } from '@/lib/validation/account'
import { faltantesDePreparacion, preparacionCompleta } from '@/server/rotation/quota'

async function usuarioActual(): Promise<string | null> {
  const sesion = await auth()
  return sesion?.user?.id ?? null
}

function leerFormulario(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of formData.entries()) out[k] = typeof v === 'string' ? v : ''
  return out
}

type ErrorPg = { code?: string; constraint?: string; cause?: unknown }

/**
 * Drizzle envuelve los errores de node-postgres, así que el código y la
 * constraint viajan en `cause`. Sin desenvolverlo, un duplicado se reporta como
 * un error genérico de conexión.
 */
function errorPg(err: unknown): ErrorPg {
  let actual = err as ErrorPg | undefined
  for (let i = 0; i < 5 && actual; i++) {
    if (typeof actual.code === 'string') return actual
    actual = actual.cause as ErrorPg | undefined
  }
  return {}
}

/** Traduce las violaciones de índice único de Postgres a algo legible. */
function traducirErrorDeBase(err: unknown): EstadoFormulario | null {
  const { code: codigo, constraint = '' } = errorPg(err)
  if (codigo !== '23505') return null

  if (constraint.includes('code')) {
    return { ok: false, error: null, campos: { code: 'Ya hay una cuenta con ese código.' } }
  }
  if (constraint.includes('phone')) {
    return { ok: false, error: null, campos: { phone: 'Ya hay una cuenta con ese número.' } }
  }
  if (constraint.includes('ig')) {
    return { ok: false, error: null, campos: { igUsername: 'Ya hay una cuenta con ese usuario.' } }
  }
  return { ok: false, error: 'Ya existe una cuenta con esos datos.', campos: {} }
}

export async function guardarCuenta(
  _prev: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const id = formData.get('id')
  const idCuenta = typeof id === 'string' && id.length > 0 ? id : null

  const parsed = accountSchema.safeParse(leerFormulario(formData))
  if (!parsed.success) {
    const campos: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const campo = String(issue.path[0] ?? '')
      if (campo && !campos[campo]) campos[campo] = issue.message
    }
    return { ok: false, error: null, campos }
  }

  const valores = parsed.data
  const actor = await usuarioActual()

  try {
    await db.transaction(async (tx) => {
      if (idCuenta) {
        const [antes] = await tx
          .select({ status: messagingAccounts.status, code: messagingAccounts.code })
          .from(messagingAccounts)
          .where(eq(messagingAccounts.id, idCuenta))
          .limit(1)

        if (!antes) throw new Error('CUENTA_INEXISTENTE')

        await tx
          .update(messagingAccounts)
          .set({ ...valores, updatedAt: new Date() })
          .where(eq(messagingAccounts.id, idCuenta))

        const cambioEstado = antes.status !== valores.status
        await tx.insert(events).values({
          type: cambioEstado
            ? valores.status === 'bloqueada'
              ? 'cuenta_bloqueada'
              : valores.status === 'pausada'
                ? 'cuenta_pausada'
                : 'cuenta_editada'
            : 'cuenta_editada',
          accountId: idCuenta,
          actorUserId: actor,
          payload: cambioEstado
            ? { desde: antes.status, hasta: valores.status, code: valores.code }
            : { code: valores.code },
        })
      } else {
        const [creada] = await tx.insert(messagingAccounts).values(valores).returning({
          id: messagingAccounts.id,
        })
        await tx.insert(events).values({
          type: 'cuenta_creada',
          accountId: creada?.id ?? null,
          actorUserId: actor,
          payload: { code: valores.code, channel: valores.channel },
        })
      }
    })
  } catch (err) {
    const traducido = traducirErrorDeBase(err)
    if (traducido) return traducido
    if (err instanceof Error && err.message === 'CUENTA_INEXISTENTE') {
      return { ok: false, error: 'Esa cuenta ya no existe. Actualizá la página.', campos: {} }
    }
    console.error('Error al guardar la cuenta:', err)
    return { ok: false, error: 'No se pudo guardar. Revisá la conexión con la base.', campos: {} }
  }

  revalidatePath('/cuentas')
  return { ok: true, error: null, campos: {} }
}

/**
 * Solo se puede borrar una cuenta que no tenga contactos asignados: borrarla
 * dejaría a esos contactos huérfanos de emisor. Si tiene lista, hay que
 * pausarla o reasignar primero.
 */
export async function borrarCuenta(id: string): Promise<EstadoAccion> {
  if (!id) return { ok: false, error: 'Falta el identificador de la cuenta.' }

  try {
    const [{ n: asignados } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(contacts)
      .where(
        sql`(${contacts.assignedWaAccountId} = ${id} or ${contacts.assignedIgAccountId} = ${id})
            and ${contacts.discardedAt} is null`,
      )

    if (asignados > 0) {
      return {
        ok: false,
        error: `Tiene ${asignados} contacto${asignados === 1 ? '' : 's'} asignado${
          asignados === 1 ? '' : 's'
        }. Reasignalos o pausá la cuenta en vez de borrarla.`,
      }
    }

    await db.delete(messagingAccounts).where(eq(messagingAccounts.id, id))
  } catch (err) {
    console.error('Error al borrar la cuenta:', err)
    return { ok: false, error: 'No se pudo borrar. Revisá la conexión con la base.' }
  }

  revalidatePath('/cuentas')
  return { ok: true, error: null }
}

/** Cambio rápido de estado desde la fila de la tabla. */
export async function cambiarEstadoCuenta(
  id: string,
  status: AccountStatus,
): Promise<EstadoAccion> {
  try {
    const [antes] = await db
      .select({
        status: messagingAccounts.status,
        code: messagingAccounts.code,
        warmupDay: messagingAccounts.warmupDay,
        prepChecklist: messagingAccounts.prepChecklist,
      })
      .from(messagingAccounts)
      .where(eq(messagingAccounts.id, id))
      .limit(1)

    if (!antes) return { ok: false, error: 'Esa cuenta ya no existe.' }

    // Un número no entra al reparto sin el checklist completo.
    if ((status === 'activa' || status === 'calentando') && !preparacionCompleta(antes.prepChecklist)) {
      const faltan = faltantesDePreparacion(antes.prepChecklist)
      return {
        ok: false,
        error: `Faltan ${faltan.length} puntos del checklist de preparación. Editá la cuenta y completalos.`,
      }
    }

    const actor = await usuarioActual()
    const hoy = opsDate()

    await db.transaction(async (tx) => {
      // Empezar a calentar arranca el día 1 si el número no venía calentando.
      const arrancaCalentamiento = status === 'calentando' && antes.status !== 'calentando'

      await tx
        .update(messagingAccounts)
        .set({
          status,
          ...(arrancaCalentamiento
            ? { warmupDay: 1, warmupStartedOn: hoy, warmupLastAdvancedOn: null, warmupRepeats: 0 }
            : {}),
          // Salir de bloqueada limpia el contador de fallos: si no, vuelve a
          // bloquearse en el primer fallo siguiente.
          ...(antes.status === 'bloqueada' && status !== 'bloqueada'
            ? { consecutiveFailures: 0 }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(messagingAccounts.id, id))

      await tx.insert(events).values({
        type:
          status === 'bloqueada'
            ? 'cuenta_bloqueada'
            : status === 'pausada'
              ? 'cuenta_pausada'
              : arrancaCalentamiento
                ? 'calentamiento_iniciado'
                : 'cuenta_editada',
        accountId: id,
        actorUserId: actor,
        payload: { desde: antes.status, hasta: status, code: antes.code },
      })
    })
  } catch (err) {
    console.error('Error al cambiar el estado:', err)
    return { ok: false, error: 'No se pudo cambiar el estado.' }
  }

  revalidatePath('/cuentas')
  return { ok: true, error: null }
}

/**
 * Saltear el calentamiento de un número, a mano y con confirmación.
 *
 * Es para números que ya vengo usando desde antes con conversaciones reales, no
 * para apurar números nuevos. Queda registrado con quién lo hizo.
 */
export async function saltearCalentamiento(id: string): Promise<EstadoAccion> {
  try {
    const [cuenta] = await db
      .select({
        code: messagingAccounts.code,
        status: messagingAccounts.status,
        warmupDay: messagingAccounts.warmupDay,
        prepChecklist: messagingAccounts.prepChecklist,
      })
      .from(messagingAccounts)
      .where(eq(messagingAccounts.id, id))
      .limit(1)

    if (!cuenta) return { ok: false, error: 'Esa cuenta ya no existe.' }
    if (cuenta.status !== 'calentando') {
      return { ok: false, error: 'Esa cuenta no está calentando.' }
    }
    if (!preparacionCompleta(cuenta.prepChecklist)) {
      return { ok: false, error: 'Completá primero el checklist de preparación.' }
    }

    const actor = await usuarioActual()
    await db.transaction(async (tx) => {
      await tx
        .update(messagingAccounts)
        .set({ status: 'activa', warmupDay: null, warmupRepeats: 0, updatedAt: new Date() })
        .where(eq(messagingAccounts.id, id))
      await tx.insert(events).values({
        type: 'calentamiento_salteado',
        accountId: id,
        actorUserId: actor,
        payload: { code: cuenta.code, diaEnQueEstaba: cuenta.warmupDay },
      })
    })
  } catch (err) {
    console.error('Error al saltear el calentamiento:', err)
    return { ok: false, error: 'No se pudo saltear el calentamiento.' }
  }

  revalidatePath('/cuentas')
  return { ok: true, error: null }
}

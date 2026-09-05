import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'
import type { LeadEstado } from '@/db/enums'
import type { PasoDeSeguimiento } from '@/lib/setters-config'
import { opsDate, OPS_TZ } from '@/lib/tz'
import { seccionDePaso, type Seccion } from '@/lib/pistas'
import { barrer } from '@/server/setters/asignacion'
import { motivoSinLeads, repartoAutomaticoDelDia } from '@/server/setters/reparto'
import { leerCupoDeSetter, PASOS_CON_CUPO, type CupoDeSetter } from '@/server/setters/cupo'
import {
  armarMensaje,
  leerPlantillasDeSetter,
  elegirPlantilla,
  leerVozOperativa,
  linksDeInstagram,
} from '@/server/setters/plantillas'

/**
 * El trabajo del día del setter, **en dos listas separadas**.
 *
 * Son dos oficios distintos y venían en una sola cola: abrirle el chat a un
 * desconocido y seguir una conversación que ya existe. Mezclados, el setter no
 * sabía cuál de los dos estaba haciendo —la pantalla llamaba "seguimiento" a
 * todo lo que no fuera la entrada, oferta y reintentos de apertura incluidos— y
 * eso importa: uno gasta cupo y puede costar la cuenta, el otro no gasta nada.
 *
 * La línea la pone `esApertura`, que es la misma que decide el cupo. Acá no se
 * decide nada nuevo: se parte la cola por donde el modelo ya estaba partido.
 *
 * Dentro de cada lista el orden sí es negociable con el celular: primero todo
 * lo de la cuenta activa, porque cambiar de cuenta en Instagram es lento. Entre
 * seguimientos manda el atraso; entre aperturas, el que está más cerca de
 * vencer.
 */

export interface ItemDeCola {
  assignmentId: string
  contactId: string
  businessName: string
  contactName: string | null
  igUsername: string
  niche: string | null
  city: string | null
  /** En cuál de las situaciones está este lead ahora. */
  paso: PasoDeSeguimiento
  /**
   * En cuál de las dos listas va. Se deduce del paso y viaja con el item para
   * que la pantalla no vuelva a decidirlo por su cuenta: es exactamente lo que
   * antes se calculaba mal con un `paso > 1`.
   */
  seccion: Seccion
  estado: LeadEstado
  /**
   * Ya tocó "Abrir Instagram" **desde el último envío**: el botón de marcar
   * está habilitado. Se rearma con cada mensaje que sale, así que un
   * seguimiento no se puede marcar sin haber abierto la conversación.
   */
  abierto: boolean
  /**
   * Desde qué cuenta hay que mandarlo.
   *
   * Un seguimiento **tiene que salir de la cuenta que abrió esa conversación**:
   * en Instagram el hilo vive ahí, y mandarlo desde otra es escribirle de cero
   * a alguien que ya te conoce. Null en los leads sin contactar, que salen de
   * la cuenta que el setter tenga activa.
   */
  cuentaId: string | null
  cuentaUsuario: string | null
  /** Esa cuenta ya llegó a su cupo: el seguimiento tiene que esperar a mañana. */
  cuentaSinCupo: boolean
  venceAt: Date
  /** Horas que le quedan antes de que el lead vuelva al pozo. */
  horasRestantes: number
  /** Días de atraso del segundo mensaje. 0 si le toca hoy. */
  diasAtraso: number
  mensaje: string | null
  /** Por qué no se puede armar el mensaje. Si está, no se puede mandar. */
  motivoBloqueo: string | null
  templateId: string | null
  templateVariant: number | null
  linkDirecto: string
  linkRespaldo: string
}

/**
 * Lo que le queda pendiente a cada cuenta.
 *
 * El setter trabaja una cuenta por vez —cambiar en Instagram desde el celular
 * es lento— así que necesita ver de un vistazo cuánto le falta en cada una y
 * decidir cuándo conviene cambiar.
 */
export interface PendienteDeCuenta {
  cuentaId: string
  igUsername: string
  activa: boolean
  usadoHoy: number
  cupoDiario: number
  restante: number
  /** Seguimientos que le tocan hoy y que **solo** se pueden mandar desde acá. */
  seguimientos: number
  /** Aperturas que salen de esta cuenta y le descuentan del cupo. */
  aperturas: number
}

/** Lo que ya hizo hoy, partido igual que la pantalla. */
export interface ResumenDelDia {
  /** Chats que abrió hoy. Es lo único que le descontó del cupo. */
  aperturas: number
  /** Mensajes que mandó sobre conversaciones ya abiertas. */
  seguimientos: number
  respondieron: number
  reuniones: number
}

export interface ColaDelSetter {
  /**
   * Los leads a los que hay que **abrirles el chat**: la entrada, y los dos
   * reintentos del que nunca contestó. Gastan cupo.
   */
  aperturas: ItemDeCola[]
  /**
   * Las conversaciones **ya abiertas** que esperan el mensaje que sigue: la
   * oferta, los dos que salen apenas el setter marca qué contestó, y los
   * escalones de silencio y tibio. No gastan cupo.
   */
  seguimientos: ItemDeCola[]
  cupo: CupoDeSetter
  /** Qué falta en cada cuenta. Ordenado igual que las cuentas del setter. */
  porCuenta: PendienteDeCuenta[]
  /** De los seguimientos, cuántos vienen de días anteriores. */
  seguimientosAtrasados: number
  /** Días del seguimiento más atrasado. Es el número que dispara la alerta. */
  diasDeAtraso: number
  /** Lo que ya hizo hoy, para la pantalla de día completado. */
  hoy: ResumenDelDia
  /**
   * Por qué no tiene nada para contactar, escrito para él.
   *
   * Solo se calcula —y solo se muestra— cuando la lista de aperturas está
   * vacía. `null` significa "puede pedir más y hay de dónde": ahí el botón
   * alcanza y una explicación sobraría.
   */
  motivoSinLeads: string | null
}

interface FilaCola {
  id: string
  contact_id: string
  estado: LeadEstado
  vence_at: Date
  abierto_at: Date | null
  proximo_paso: number | null
  proximo_seguimiento_at: Date | null
  setter_account_id: string | null
  business_name: string
  contact_name: string | null
  ig_username: string
  niche: string | null
  city: string | null
  bought: string | null
}

export async function armarColaDelSetter(setterId: string): Promise<ColaDelSetter> {
  // Antes de mostrar nada, se pone al día lo que depende del reloj: leads
  // vencidos que vuelven al pozo, salteados de ayer que vuelven a la cola, y la
  // tanda del día si todavía no salió. Nada de eso espera a un cron: el setter
  // abre la app y encuentra su cola armada.
  await barrer()
  await repartoAutomaticoDelDia()

  const [cupo, plantillas, voz] = await Promise.all([
    leerCupoDeSetter(setterId),
    leerPlantillasDeSetter(),
    leerVozOperativa(),
  ])

  const filas = await db.execute(sql`
    select la.id, la.contact_id, la.estado, la.vence_at, la.abierto_at,
           la.proximo_paso, la.proximo_seguimiento_at, la.setter_account_id,
           c.business_name, c.contact_name, c.ig_username, c.niche, c.city, c.bought
      from lead_assignments la
      join contacts c on c.id = la.contact_id
      -- La ficha del setter entra solo por su cuenta activa: es lo que ordena
      -- la cola para que no tenga que saltar de una cuenta a otra.
      join setters s on s.id = la.setter_id
     where la.setter_id = ${setterId}::uuid
       and (
         -- Le toca un seguimiento: cualquiera de los que siguen a la entrada,
         -- según en qué silencio quedó o qué marcó el setter.
         (la.proximo_seguimiento_at is not null and la.proximo_seguimiento_at <= now())
         -- O nunca recibió nada y le toca la entrada.
         or la.estado in ('asignado', 'abierto', 'saltado')
       )
     order by
       -- **Primero, todo lo de la cuenta con la que está trabajando.**
       -- Cambiar de cuenta en Instagram desde el celular es lento; si la cola
       -- lo mandara a saltar de una a otra cada dos leads, no trabajaría.
       -- Los que no tienen cuenta todavía (sin contactar) salen de la activa.
       case when la.setter_account_id is null
              or la.setter_account_id = s.cuenta_activa_id then 0 else 1 end,
       -- Dentro de una cuenta, lo programado antes que lo que nunca se tocó.
       -- Las dos listas se separan después, en JS, y cada una hereda este
       -- orden: entre seguimientos deja arriba al más atrasado, y entre
       -- aperturas al reintento, que tiene fecha, antes que la entrada.
       case when la.proximo_seguimiento_at is not null
             and la.proximo_seguimiento_at <= now() then 0 else 1 end,
       -- Entre seguimientos, el más atrasado arriba.
       la.proximo_seguimiento_at asc nulls last,
       -- Entre nuevos, los salteados al final y el resto por vencimiento.
       case when la.estado = 'saltado' then 1 else 0 end,
       la.vence_at asc
     limit 300
  `)

  /*
   * Qué cuenta es cuál, y cuáles ya no tienen lugar hoy. Se arma una vez y se
   * consulta por lead: un seguimiento cuya cuenta llegó al tope no se puede
   * mandar aunque el setter tenga otra libre, porque el hilo está en esa.
   */
  const usuarioDeCuenta = new Map(cupo.cuentas.map((c) => [c.id, c.igUsername]))
  const sinCupo = new Set(cupo.cuentas.filter((c) => c.restante <= 0).map((c) => c.id))

  const ahora = Date.now()
  const items: ItemDeCola[] = []

  for (const f of filas.rows as unknown as FilaCola[]) {
    const programado = f.proximo_seguimiento_at ? new Date(f.proximo_seguimiento_at) : null
    const leToca = programado !== null && programado.getTime() <= ahora

    // Si tiene seguimiento vencido, le toca ese paso. Si no, es un lead sin
    // tocar y le toca la entrada.
    const paso: PasoDeSeguimiento = leToca ? ((f.proximo_paso ?? 1) as PasoDeSeguimiento) : 1

    const armado = armarMensaje(
      elegirPlantilla(plantillas, paso, f.niche),
      {
        businessName: f.business_name,
        contactName: f.contact_name,
        niche: f.niche,
        bought: f.bought,
        city: f.city,
      },
      voz,
      paso,
    )

    const vence = new Date(f.vence_at)

    items.push({
      assignmentId: f.id,
      contactId: f.contact_id,
      businessName: f.business_name,
      contactName: f.contact_name,
      igUsername: f.ig_username,
      niche: f.niche,
      city: f.city,
      paso,
      seccion: seccionDePaso(paso),
      estado: f.estado,
      abierto: f.abierto_at !== null,
      cuentaId: f.setter_account_id,
      cuentaUsuario: f.setter_account_id ? (usuarioDeCuenta.get(f.setter_account_id) ?? null) : null,
      cuentaSinCupo: f.setter_account_id ? (sinCupo.has(f.setter_account_id)) : false,
      venceAt: vence,
      horasRestantes: Math.max(Math.floor((vence.getTime() - ahora) / 3_600_000), 0),
      diasAtraso: programado
        ? Math.max(Math.floor((ahora - programado.getTime()) / 86_400_000), 0)
        : 0,
      mensaje: armado.ok ? armado.texto : null,
      motivoBloqueo: armado.ok ? null : armado.motivo,
      templateId: armado.ok ? armado.templateId : null,
      templateVariant: armado.ok ? armado.variante : null,
      ...linksDeInstagram(f.ig_username),
    })
  }

  /*
   * El corte. Un mensaje va a una lista o a la otra según abra el chat o no, y
   * eso no depende de en qué número de paso esté: la oferta es el paso 2 y no
   * abre nada, el reintento es el 17 y abre. Contarlo por `paso > 1` era lo que
   * ponía aperturas adentro de la lista de seguimientos.
   */
  const aperturas = items.filter((i) => i.seccion === 'apertura')
  const seguimientos = items.filter((i) => i.seccion === 'seguimiento')

  /*
   * Cuánto le falta en cada cuenta. Los seguimientos se cuentan sobre la cuenta
   * que abrió esa conversación, no sobre la activa: es la única desde la que se
   * pueden mandar. Las aperturas de leads sin tocar todavía no tienen cuenta
   * —salen de la activa—, así que solo se cuentan acá los reintentos, que sí la
   * tienen y sí le descuentan del cupo.
   */
  const porCuenta: PendienteDeCuenta[] = cupo.cuentas.map((c) => ({
    cuentaId: c.id,
    igUsername: c.igUsername,
    activa: c.id === cupo.activa?.id,
    usadoHoy: c.enviadosHoy,
    cupoDiario: c.cupoDiario,
    restante: c.restante,
    seguimientos: seguimientos.filter((i) => i.cuentaId === c.id).length,
    aperturas: aperturas.filter((i) => i.cuentaId === c.id).length,
  }))

  return {
    aperturas,
    seguimientos,
    cupo,
    porCuenta,
    seguimientosAtrasados: seguimientos.filter((i) => i.diasAtraso > 0).length,
    diasDeAtraso: seguimientos.reduce((a, i) => Math.max(a, i.diasAtraso), 0),
    hoy: await resumenDelDia(setterId),
    // Se consulta solo con la lista vacía: es una recorrida por todo el equipo
    // y con leads adelante no hay nada que explicar.
    motivoSinLeads: aperturas.length === 0 ? await motivoSinLeads(setterId) : null,
  }
}

/**
 * Lo que hizo hoy. Es lo que ve en la pantalla de día completado.
 *
 * Los dos trabajos van por separado también acá: "mandé 30 mensajes" no dice
 * nada si veinte eran seguimientos, porque lo que se le agota es el cupo de
 * abrir chats y son dos números distintos. Se separan por el mismo filtro que
 * usa el cupo, así el número de aperturas es exactamente el que le descontó.
 */
export async function resumenDelDia(setterId: string): Promise<ResumenDelDia> {
  const hoy = opsDate()

  const filas = await db.execute(sql`
    select
      (select count(*)::int from setter_sends ss
        where ss.setter_id = ${setterId}::uuid and ss.ops_date = ${hoy}::date
          and ss.undone_at is null
          and ss.paso in (${PASOS_CON_CUPO})) as aperturas,
      (select count(*)::int from setter_sends ss
        where ss.setter_id = ${setterId}::uuid and ss.ops_date = ${hoy}::date
          and ss.undone_at is null
          and ss.paso not in (${PASOS_CON_CUPO})) as seguimientos,
      (select count(*)::int from lead_assignments la
        where la.setter_id = ${setterId}::uuid
          and la.respondido_at is not null
          and (la.respondido_at at time zone ${OPS_TZ})::date = ${hoy}::date) as respondieron,
      (select count(*)::int from meetings m
        where m.setter_id = ${setterId}::uuid
          and (m.created_at at time zone ${OPS_TZ})::date = ${hoy}::date) as reuniones
  `)

  const f = filas.rows[0] as ResumenDelDia | undefined

  return {
    aperturas: f?.aperturas ?? 0,
    seguimientos: f?.seguimientos ?? 0,
    respondieron: f?.respondieron ?? 0,
    reuniones: f?.reuniones ?? 0,
  }
}

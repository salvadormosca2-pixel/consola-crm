import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'
import type { LeadEstado, LeadInteres, SetterSendTipo, UserStatus } from '@/db/enums'
import { SETTERS_CONFIG_DEFAULT } from '@/lib/setters-config'
import type { Vista } from '@/lib/setters-vistas'
import { opsDate, OPS_TZ } from '@/lib/tz'
import { barrer } from '@/server/setters/asignacion'
import { leerCuposDelEquipo, type CupoDeSetter } from '@/server/setters/cupo'

/**
 * Lo que necesito ver yo.
 *
 * En cualquier momento tengo que poder saber tres cosas sin abrir nada: qué
 * hizo cada setter, qué falta hacer, y qué necesita mi atención ya. Todo lo de
 * este archivo está armado alrededor de esas tres preguntas.
 */

/**
 * Qué cuenta como seguimiento pendiente. **Una sola definición para todo el
 * panel.**
 *
 * Antes cada consulta lo contaba a su manera —el tablero miraba solo el segundo
 * mensaje— y el mismo setter aparecía con tres números distintos según la
 * pantalla. Un seguimiento es cualquier mensaje que no sea la entrada: la
 * oferta y los tres reenganches, y todos se programan igual.
 *
 * Es exactamente lo que hace aparecer al lead en la cola del setter, así que lo
 * que dice el panel es lo que hay en el celular de alguien.
 */
export const SEGUIMIENTO_PENDIENTE = sql`la.proximo_seguimiento_at is not null
                                     and la.proximo_seguimiento_at <= now()
                                     and la.estado not in ('vencido', 'devuelto', 'cuenta_inexistente')`

/** Atraso en días operativos: lo de anoche a la mañana ya es un día. */
export const DIAS_DE_ATRASO = sql`greatest(0, (now() at time zone ${OPS_TZ})::date
                                            - (la.proximo_seguimiento_at at time zone ${OPS_TZ})::date)`

/* ── Tablero del día ──────────────────────────────────────────────────── */

export type Semaforo = 'verde' | 'amarillo' | 'rojo'

export interface FilaTablero {
  setterId: string
  userId: string
  nombre: string
  email: string
  estado: UserStatus
  cupo: CupoDeSetter | null
  /** Mensajes mandados hoy, sobre la tanda del día. */
  hoy: number
  tanda: number
  seguimientosHechos: number
  seguimientosPendientes: number
  diasAtraso: number
  respondieron: number
  reuniones: number
  sinContactar: number
  ultimaActividad: Date | null
  ultimoIngreso: Date | null
  semaforo: Semaforo
  /** Por qué está en ese color. Un semáforo sin motivo no sirve para decidir. */
  motivo: string
}

interface FilaCruda {
  setter_id: string
  user_id: string
  nombre: string
  email: string
  estado: UserStatus
  tanda_diaria: number
  ultimo_ingreso: Date | null
  hoy: number
  seguimientos_hechos: number
  seguimientos_pendientes: number
  dias_atraso: number
  respondieron: number
  reuniones: number
  sin_contactar: number
  ultima_actividad: Date | null
}

/**
 * Una línea por setter. De un vistazo tengo que ver quién trabajó hoy y quién
 * no, sin abrir nada.
 */
export async function armarTablero(): Promise<FilaTablero[]> {
  await barrer()

  const hoy = opsDate()
  const cfg = SETTERS_CONFIG_DEFAULT

  const filas = await db.execute(sql`
    select s.id as setter_id, u.id as user_id, u.name as nombre, u.email, u.status as estado,
           s.tanda_diaria, u.last_login_at as ultimo_ingreso,

           (select count(*)::int from setter_sends ss
             where ss.setter_id = s.id and ss.ops_date = ${hoy}::date
               and ss.undone_at is null) as hoy,

           (select count(*)::int from setter_sends ss
             where ss.setter_id = s.id and ss.ops_date = ${hoy}::date
               and ss.paso > 1 and ss.undone_at is null) as seguimientos_hechos,

           (select count(*)::int from lead_assignments la
             where la.setter_id = s.id and ${SEGUIMIENTO_PENDIENTE}) as seguimientos_pendientes,

           coalesce((select max(${DIAS_DE_ATRASO})::int from lead_assignments la
                      where la.setter_id = s.id and ${SEGUIMIENTO_PENDIENTE}), 0) as dias_atraso,

           (select count(*)::int from lead_assignments la
             where la.setter_id = s.id and la.respondido_at is not null
               and (la.respondido_at at time zone ${OPS_TZ})::date = ${hoy}::date) as respondieron,

           (select count(*)::int from meetings m
             where m.setter_id = s.id
               and (m.created_at at time zone ${OPS_TZ})::date = ${hoy}::date) as reuniones,

           (select count(*)::int from lead_assignments la
             where la.setter_id = s.id
               and la.estado in ('asignado', 'abierto', 'saltado')) as sin_contactar,

           (select max(ss.sent_at) from setter_sends ss
             where ss.setter_id = s.id and ss.undone_at is null) as ultima_actividad

      from setters s
      join users u on u.id = s.user_id
     where u.status <> 'baja'
     order by u.name asc
  `)

  const cupos = await leerCuposDelEquipo()

  return (filas.rows as unknown as FilaCruda[]).map((f) => {
    const asignadosHoy = f.hoy
    const pendientes = f.seguimientos_pendientes

    let semaforo: Semaforo = 'verde'
    let motivo = 'Al día.'

    if (f.estado === 'pausado') {
      semaforo = 'amarillo'
      motivo = 'Pausado: no recibe leads nuevos.'
    } else if (f.dias_atraso >= cfg.diasAtrasoParaAlerta) {
      semaforo = 'rojo'
      motivo = `${f.dias_atraso} días de atraso en los seguimientos.`
    } else if (asignadosHoy === 0 && (f.sin_contactar > 0 || pendientes > 0)) {
      semaforo = 'rojo'
      motivo = 'Hoy no contactó a nadie y tiene trabajo pendiente.'
    } else if (pendientes > 0) {
      semaforo = 'amarillo'
      motivo = `${pendientes} seguimientos sin hacer.`
    } else if (asignadosHoy === 0) {
      semaforo = 'amarillo'
      motivo = 'Todavía no arrancó hoy.'
    }

    return {
      setterId: f.setter_id,
      userId: f.user_id,
      nombre: f.nombre,
      email: f.email,
      estado: f.estado,
      cupo: cupos.get(f.setter_id) ?? null,
      hoy: asignadosHoy,
      tanda: f.tanda_diaria,
      seguimientosHechos: f.seguimientos_hechos,
      seguimientosPendientes: pendientes,
      diasAtraso: f.dias_atraso,
      respondieron: f.respondieron,
      reuniones: f.reuniones,
      sinContactar: f.sin_contactar,
      ultimaActividad: f.ultima_actividad ? new Date(f.ultima_actividad) : null,
      ultimoIngreso: f.ultimo_ingreso ? new Date(f.ultimo_ingreso) : null,
      semaforo,
      motivo,
    }
  })
}

/* ── Vistas de leads ──────────────────────────────────────────────────────
   Los rótulos y explicaciones viven en `@/lib/setters-vistas`, porque los usa
   también el componente de cliente que dibuja las pestañas.                 */

export interface FilaVista {
  assignmentId: string
  contactId: string
  businessName: string
  igUsername: string | null
  niche: string | null
  city: string | null
  estado: LeadEstado
  setterId: string | null
  setterNombre: string | null
  asignadoAt: Date
  contactadoAt: Date | null
  respondidoAt: Date | null
  segundoProgramadoAt: Date | null
  segundoMensajeAt: Date | null
  venceAt: Date
  devueltoMotivo: string | null
  respondioA: SetterSendTipo | null
  interes: LeadInteres | null
  nota: string | null
  /** Horas hasta el vencimiento, o días de atraso, según la vista. */
  horas: number
  dias: number
}

export interface FiltrosDeVista {
  setterId?: string | null
  desde?: string | null
  hasta?: string | null
}

const CONDICIONES: Record<Vista, ReturnType<typeof sql>> = {
  // Contestaron el gancho: todavía no saben qué les ofrecemos.
  respondieron: sql`la.estado = 'respondido'
                    and coalesce(la.respondio_a, 'primero') = 'primero'
                    and c.stage = 'respondido'`,
  // Contestaron la oferta: ya dijeron que sí o que no.
  oferta: sql`la.respondio_a = 'segundo'`,
  sin_contactar: sql`la.estado in ('asignado', 'abierto', 'saltado')`,
  sin_respuesta: sql`la.estado = 'segundo_enviado' and la.respondido_at is null`,
  // Todo seguimiento vencido, no solo el segundo mensaje: los reenganches se
  // atrasan igual y se pierden igual.
  esperando_segundo: sql`${SEGUIMIENTO_PENDIENTE}`,
  vencidos: sql`la.estado in ('vencido', 'devuelto')`,
  inexistentes: sql`la.estado = 'cuenta_inexistente'`,
}

const ORDENES: Record<Vista, ReturnType<typeof sql>> = {
  respondieron: sql`la.respondido_at asc`,
  // Los que dijeron que sí, primero: son los que hay que atender hoy.
  oferta: sql`(la.interes = 'interesa') desc, la.respondido_at asc`,
  sin_contactar: sql`la.vence_at asc`,
  sin_respuesta: sql`la.segundo_mensaje_at asc`,
  esperando_segundo: sql`la.proximo_seguimiento_at asc`,
  vencidos: sql`la.devuelto_at desc`,
  inexistentes: sql`la.devuelto_at desc`,
}

export async function listarVista(
  vista: Vista,
  filtros: FiltrosDeVista = {},
): Promise<FilaVista[]> {
  const filas = await db.execute(sql`
    select la.id, la.contact_id, la.estado, la.asignado_at, la.contactado_at,
           la.respondido_at, la.segundo_programado_at, la.segundo_mensaje_at, la.vence_at,
           la.devuelto_motivo, la.nota,
           la.respondio_a, la.interes,
           la.setter_id, u.name as setter_nombre,
           c.business_name, c.ig_username, c.niche, c.city
      from lead_assignments la
      join contacts c on c.id = la.contact_id
      left join setters s on s.id = la.setter_id
      left join users u on u.id = s.user_id
     where ${CONDICIONES[vista]}
       ${filtros.setterId ? sql`and la.setter_id = ${filtros.setterId}::uuid` : sql``}
       ${
         filtros.desde
           ? sql`and (la.asignado_at at time zone ${OPS_TZ})::date >= ${filtros.desde}::date`
           : sql``
       }
       ${
         filtros.hasta
           ? sql`and (la.asignado_at at time zone ${OPS_TZ})::date <= ${filtros.hasta}::date`
           : sql``
       }
     order by ${ORDENES[vista]}
     limit 500
  `)

  const ahora = Date.now()

  return (filas.rows as Array<{
    id: string
    contact_id: string
    estado: LeadEstado
    asignado_at: Date
    contactado_at: Date | null
    respondido_at: Date | null
    segundo_programado_at: Date | null
    segundo_mensaje_at: Date | null
    vence_at: Date
    devuelto_motivo: string | null
    respondio_a: SetterSendTipo | null
    interes: LeadInteres | null
    nota: string | null
    setter_id: string | null
    setter_nombre: string | null
    business_name: string
    ig_username: string | null
    niche: string | null
    city: string | null
  }>).map((f) => {
    const vence = new Date(f.vence_at)
    const programado = f.segundo_programado_at ? new Date(f.segundo_programado_at) : null
    return {
      assignmentId: f.id,
      contactId: f.contact_id,
      businessName: f.business_name,
      igUsername: f.ig_username,
      niche: f.niche,
      city: f.city,
      estado: f.estado,
      setterId: f.setter_id,
      setterNombre: f.setter_nombre,
      asignadoAt: new Date(f.asignado_at),
      contactadoAt: f.contactado_at ? new Date(f.contactado_at) : null,
      respondidoAt: f.respondido_at ? new Date(f.respondido_at) : null,
      segundoProgramadoAt: programado,
      segundoMensajeAt: f.segundo_mensaje_at ? new Date(f.segundo_mensaje_at) : null,
      venceAt: vence,
      devueltoMotivo: f.devuelto_motivo,
      respondioA: f.respondio_a,
      interes: f.interes,
      nota: f.nota,
      horas: Math.max(Math.floor((vence.getTime() - ahora) / 3_600_000), 0),
      dias: programado ? Math.max(Math.floor((ahora - programado.getTime()) / 86_400_000), 0) : 0,
    }
  })
}

/* ── Ficha de un setter ───────────────────────────────────────────────── */

export interface CuentaDelPanel {
  id: string
  igUsername: string
  cupoDiario: number
  enviadosHoy: number
  activa: boolean
  orden: number
  ultimoEnvioAt: Date | null
  /** Tasa de respuesta de los últimos días con esta cuenta. */
  tasa: number | null
  mandados: number
  salud: 'verde' | 'amarillo' | 'rojo'
  motivoSalud: string
}

export interface NumerosDeSetter {
  asignados: number
  contactados: number
  segundos: number
  respondieron: number
  reuniones: number
  cerrados: number
  tasa: number | null
}

export interface FichaDeSetter {
  setterId: string
  userId: string
  nombre: string
  email: string
  estado: UserStatus
  rol: string
  tandaDiaria: number
  variante: number
  recordatorioAutomatico: boolean
  horaRecordatorio: string
  ultimoIngreso: Date | null
  ultimoIngresoIp: string | null
  creadoEl: Date
  debeCambiarPassword: boolean
  cuentas: CuentaDelPanel[]
  dia: NumerosDeSetter
  semana: NumerosDeSetter
  mes: NumerosDeSetter
  seguimientosPendientes: number
  diasAtraso: number
  sinContactar: number
}

const NUMEROS = (desde: string) => sql`
  select
    (select count(*)::int from lead_assignments la
      where la.setter_id = s.id
        and (la.asignado_at at time zone ${OPS_TZ})::date >= ${desde}::date) as asignados,
    (select count(*)::int from setter_sends ss
      where ss.setter_id = s.id and ss.tipo = 'primero' and ss.undone_at is null
        and ss.ops_date >= ${desde}::date) as contactados,
    (select count(*)::int from setter_sends ss
      where ss.setter_id = s.id and ss.tipo = 'segundo' and ss.undone_at is null
        and ss.ops_date >= ${desde}::date) as segundos,
    (select count(*)::int from lead_assignments la
      where la.setter_id = s.id and la.respondido_at is not null
        and (la.respondido_at at time zone ${OPS_TZ})::date >= ${desde}::date) as respondieron,
    (select count(*)::int from meetings m
      where m.setter_id = s.id
        and (m.created_at at time zone ${OPS_TZ})::date >= ${desde}::date) as reuniones,
    (select count(*)::int from contacts c
      where c.setter_id = s.id and c.stage = 'cerrado') as cerrados
`

export async function leerFicha(setterId: string): Promise<FichaDeSetter | null> {
  const cfg = SETTERS_CONFIG_DEFAULT
  const hoy = opsDate()
  const semana = opsDate(new Date(Date.now() - 6 * 86_400_000))
  const mes = opsDate(new Date(Date.now() - 29 * 86_400_000))

  const base = await db.execute(sql`
    select s.id, s.tanda_diaria, s.variante, s.recordatorio_automatico, s.hora_recordatorio,
           s.created_at,
           u.id as user_id, u.name, u.email, u.status, u.role,
           u.last_login_at, u.last_login_ip, u.must_change_password,
           (select count(*)::int from lead_assignments la
             where la.setter_id = s.id and ${SEGUIMIENTO_PENDIENTE}) as seguimientos_pendientes,
           coalesce((select max(${DIAS_DE_ATRASO})::int from lead_assignments la
                      where la.setter_id = s.id and ${SEGUIMIENTO_PENDIENTE}), 0) as dias_atraso,
           (select count(*)::int from lead_assignments la
             where la.setter_id = s.id
               and la.estado in ('asignado', 'abierto', 'saltado')) as sin_contactar
      from setters s
      join users u on u.id = s.user_id
     where s.id = ${setterId}::uuid
     limit 1
  `)

  const b = base.rows[0] as
    | {
        id: string
        tanda_diaria: number
        variante: number
        recordatorio_automatico: boolean
        hora_recordatorio: string
        created_at: Date
        user_id: string
        name: string
        email: string
        status: UserStatus
        role: string
        last_login_at: Date | null
        last_login_ip: string | null
        must_change_password: boolean
        seguimientos_pendientes: number
        dias_atraso: number
        sin_contactar: number
      }
    | undefined

  if (!b) return null

  async function numerosDesde(desde: string): Promise<NumerosDeSetter> {
    const r = await db.execute(sql`
      with s as (select ${setterId}::uuid as id)
      ${NUMEROS(desde)} from s
    `)
    const f = r.rows[0] as
      | {
          asignados: number
          contactados: number
          segundos: number
          respondieron: number
          reuniones: number
          cerrados: number
        }
      | undefined

    const vacio = {
      asignados: 0,
      contactados: 0,
      segundos: 0,
      respondieron: 0,
      reuniones: 0,
      cerrados: 0,
    }
    const datos = f ?? vacio
    return {
      ...datos,
      // Sin mensajes mandados la tasa no existe: 0 de 0 no es 0%, es "todavía
      // no se sabe", y mostrar 0% haría parecer restringida una cuenta nueva.
      tasa: datos.contactados > 0 ? datos.respondieron / datos.contactados : null,
    }
  }

  const [dia, sem, mesN] = await Promise.all([
    numerosDesde(hoy),
    numerosDesde(semana),
    numerosDesde(mes),
  ])

  const cuentas = await db.execute(sql`
    select sa.id, sa.ig_username, sa.cupo_diario, sa.activa, sa.orden, sa.ultimo_envio_at,
           coalesce((select count(*)::int from setter_sends ss
                      where ss.setter_account_id = sa.id and ss.undone_at is null
                        and ss.ops_date = ${hoy}::date), 0) as enviados_hoy,
           coalesce((select count(*)::int from setter_sends ss
                      where ss.setter_account_id = sa.id and ss.undone_at is null
                        and ss.ops_date >= ${semana}::date), 0) as mandados,
           coalesce((select count(distinct la.id)::int
                       from setter_sends ss
                       join lead_assignments la on la.id = ss.assignment_id
                      where ss.setter_account_id = sa.id and ss.undone_at is null
                        and ss.ops_date >= ${semana}::date
                        and la.respondido_at is not null), 0) as respondieron
      from setter_accounts sa
     where sa.setter_id = ${setterId}::uuid
     order by sa.orden asc
  `)

  return {
    setterId: b.id,
    userId: b.user_id,
    nombre: b.name,
    email: b.email,
    estado: b.status,
    rol: b.role,
    tandaDiaria: b.tanda_diaria,
    variante: b.variante,
    recordatorioAutomatico: b.recordatorio_automatico,
    horaRecordatorio: b.hora_recordatorio.slice(0, 5),
    ultimoIngreso: b.last_login_at ? new Date(b.last_login_at) : null,
    ultimoIngresoIp: b.last_login_ip,
    creadoEl: new Date(b.created_at),
    debeCambiarPassword: b.must_change_password,
    cuentas: (cuentas.rows as Array<{
      id: string
      ig_username: string
      cupo_diario: number
      activa: boolean
      orden: number
      ultimo_envio_at: Date | null
      enviados_hoy: number
      mandados: number
      respondieron: number
    }>).map((c) => {
      const tasa = c.mandados >= cfg.minimoParaMedirTasa ? c.respondieron / c.mandados : null
      const salud: 'verde' | 'amarillo' | 'rojo' =
        tasa === null ? 'amarillo' : tasa < cfg.tasaRespuestaMinima ? 'rojo' : 'verde'
      return {
        id: c.id,
        igUsername: c.ig_username,
        cupoDiario: c.cupo_diario,
        enviadosHoy: c.enviados_hoy,
        activa: c.activa,
        orden: c.orden,
        ultimoEnvioAt: c.ultimo_envio_at ? new Date(c.ultimo_envio_at) : null,
        tasa,
        mandados: c.mandados,
        salud,
        motivoSalud:
          tasa === null
            ? `Todavía no mandó ${cfg.minimoParaMedirTasa} mensajes esta semana: la tasa no significa nada.`
            : tasa < cfg.tasaRespuestaMinima
              ? `${(tasa * 100).toFixed(1)}% de respuesta en la semana. Probable restricción de la cuenta o mensaje que no funciona.`
              : `${(tasa * 100).toFixed(1)}% de respuesta en la semana.`,
      }
    }),
    dia,
    semana: sem,
    mes: mesN,
    seguimientosPendientes: b.seguimientos_pendientes,
    diasAtraso: b.dias_atraso,
    sinContactar: b.sin_contactar,
  }
}

/* ── Línea de tiempo ──────────────────────────────────────────────────── */

export interface EventoDeSetter {
  id: string
  tipo: string
  cuando: Date
  negocio: string | null
  igUsername: string | null
  cuenta: string | null
  detalle: string | null
}

/**
 * Cada lead que contactó, a qué hora, con qué cuenta y qué marcó. Es lo que me
 * evita tener que preguntarle nada.
 */
export async function lineaDeTiempo(setterId: string, limite = 120): Promise<EventoDeSetter[]> {
  const filas = await db.execute(sql`
    select ss.id, ss.sent_at as cuando,
           case ss.tipo when 'primero' then 'lead_contactado' else 'lead_segundo_enviado' end as tipo,
           c.business_name as negocio, c.ig_username, sa.ig_username as cuenta,
           case when ss.undone_at is not null then 'Deshecho' else null end as detalle
      from setter_sends ss
      join contacts c on c.id = ss.contact_id
      join setter_accounts sa on sa.id = ss.setter_account_id
     where ss.setter_id = ${setterId}::uuid

    union all

    select la.id, la.respondido_at as cuando, 'lead_respondio' as tipo,
           c.business_name, c.ig_username, null as cuenta, la.nota as detalle
      from lead_assignments la
      join contacts c on c.id = la.contact_id
     where la.setter_id = ${setterId}::uuid and la.respondido_at is not null

    union all

    select m.id, m.created_at as cuando, 'reunion_agendada' as tipo,
           c.business_name, c.ig_username, null as cuenta,
           to_char(m.scheduled_at at time zone ${OPS_TZ}, 'DD/MM HH24:MI') as detalle
      from meetings m
      join contacts c on c.id = m.contact_id
     where m.setter_id = ${setterId}::uuid

    order by cuando desc
    limit ${limite}
  `)

  return (filas.rows as Array<{
    id: string
    tipo: string
    cuando: Date
    negocio: string | null
    ig_username: string | null
    cuenta: string | null
    detalle: string | null
  }>).map((f) => ({
    id: `${f.tipo}-${f.id}`,
    tipo: f.tipo,
    cuando: new Date(f.cuando),
    negocio: f.negocio,
    igUsername: f.ig_username,
    cuenta: f.cuenta,
    detalle: f.detalle,
  }))
}

/** El historial de recordatorios que le mandé y qué hizo después de cada uno. */
export interface RecordatorioDelPanel {
  id: string
  tipo: string
  automatico: boolean
  texto: string
  createdAt: Date
  vistoAt: Date | null
  /** Seguimientos que hizo en las 24 h siguientes al recordatorio. */
  hizoDespues: number
}

export async function historialDeRecordatorios(
  setterId: string,
): Promise<RecordatorioDelPanel[]> {
  const filas = await db.execute(sql`
    select r.id, r.tipo, r.automatico, r.texto, r.created_at, r.visto_at,
           (select count(*)::int from setter_sends ss
             where ss.setter_id = r.setter_id and ss.tipo = 'segundo' and ss.undone_at is null
               and ss.sent_at between r.created_at and r.created_at + interval '24 hours')
             as hizo_despues
      from recordatorios r
     where r.setter_id = ${setterId}::uuid
     order by r.created_at desc
     limit 30
  `)

  return (filas.rows as Array<{
    id: string
    tipo: string
    automatico: boolean
    texto: string
    created_at: Date
    visto_at: Date | null
    hizo_despues: number
  }>).map((f) => ({
    id: f.id,
    tipo: f.tipo,
    automatico: f.automatico,
    texto: f.texto,
    createdAt: new Date(f.created_at),
    vistoAt: f.visto_at ? new Date(f.visto_at) : null,
    hizoDespues: f.hizo_despues,
  }))
}

/**
 * Los leads que trajo y terminaron cerrados.
 *
 * Es el renglón que se paga: contactar mucho sin cerrar nada no es lo que se
 * está comprando. Va con nombre y fecha para poder liquidar sin discutir.
 */
export interface LeadCerrado {
  contactId: string
  businessName: string
  igUsername: string | null
  contactadoAt: Date | null
  cerradoAt: Date
}

export async function listarCerrados(setterId: string): Promise<LeadCerrado[]> {
  const filas = await db.execute(sql`
    select c.id, c.business_name, c.ig_username, c.updated_at as cerrado_at,
           la.contactado_at
      from contacts c
      left join lateral (
        select contactado_at from lead_assignments
         where contact_id = c.id and setter_id = ${setterId}::uuid
         order by created_at desc limit 1
      ) la on true
     where c.setter_id = ${setterId}::uuid and c.stage = 'cerrado'
     order by c.updated_at desc
     limit 100
  `)

  return (filas.rows as Array<{
    id: string
    business_name: string
    ig_username: string | null
    cerrado_at: Date
    contactado_at: Date | null
  }>).map((f) => ({
    contactId: f.id,
    businessName: f.business_name,
    igUsername: f.ig_username,
    contactadoAt: f.contactado_at ? new Date(f.contactado_at) : null,
    cerradoAt: new Date(f.cerrado_at),
  }))
}

/* ── Las listas de la ficha, una por pestaña ──────────────────────────── */

export const SECCIONES_FICHA = [
  'resumen',
  'enviados',
  'primero',
  'oferta',
  'reuniones',
] as const
export type SeccionFicha = (typeof SECCIONES_FICHA)[number]

export interface FilaDeSeccion {
  id: string
  businessName: string
  igUsername: string | null
  niche: string | null
  cuando: Date
  /** El dato que importa en esa pestaña: la cuenta, la nota, la hora. */
  detalle: string | null
  /** Segunda línea, cuando hace falta contexto. */
  extra: string | null
}

const CONSULTAS: Record<Exclude<SeccionFicha, 'resumen'>, (setterId: string) => ReturnType<typeof sql>> = {
  // A quién le mandó y con qué cuenta.
  enviados: (setterId) => sql`
    select ss.id, c.business_name, c.ig_username, c.niche, ss.sent_at as cuando,
           '@' || sa.ig_username as detalle,
           case ss.tipo when 'primero' then 'Mensaje de entrada' else 'Mensaje de la oferta' end as extra
      from setter_sends ss
      join contacts c on c.id = ss.contact_id
      join setter_accounts sa on sa.id = ss.setter_account_id
     where ss.setter_id = ${setterId}::uuid and ss.undone_at is null
     order by ss.sent_at desc
     limit 300
  `,
  // Contestaron el primer mensaje: abrieron conversación.
  primero: (setterId) => sql`
    select la.id, c.business_name, c.ig_username, c.niche, la.respondido_at as cuando,
           la.nota as detalle, null as extra
      from lead_assignments la
      join contacts c on c.id = la.contact_id
     where la.setter_id = ${setterId}::uuid
       and la.respondido_at is not null
       and coalesce(la.respondio_a, 'primero') = 'primero'
     order by la.respondido_at desc
     limit 300
  `,
  // Contestaron la oferta: dijeron que sí o que no.
  oferta: (setterId) => sql`
    select la.id, c.business_name, c.ig_username, c.niche, la.respondido_at as cuando,
           case la.interes when 'interesa' then 'Le interesa'
                           when 'no_interesa' then 'No le interesa'
                           else null end as detalle,
           la.nota as extra
      from lead_assignments la
      join contacts c on c.id = la.contact_id
     where la.setter_id = ${setterId}::uuid and la.respondio_a = 'segundo'
     order by (la.interes = 'interesa') desc, la.respondido_at desc
     limit 300
  `,
  reuniones: (setterId) => sql`
    select m.id, c.business_name, c.ig_username, c.niche, m.scheduled_at as cuando,
           case m.type when 'llamada' then 'Llamada'
                       when 'videollamada' then 'Videollamada'
                       else 'Presencial' end as detalle,
           m.notes as extra
      from meetings m
      join contacts c on c.id = m.contact_id
     where m.setter_id = ${setterId}::uuid
     order by m.scheduled_at desc
     limit 300
  `,
}

export async function listarSeccion(
  setterId: string,
  seccion: Exclude<SeccionFicha, 'resumen'>,
): Promise<FilaDeSeccion[]> {
  const filas = await db.execute(CONSULTAS[seccion](setterId))

  return (filas.rows as Array<{
    id: string
    business_name: string
    ig_username: string | null
    niche: string | null
    cuando: Date
    detalle: string | null
    extra: string | null
  }>).map((f) => ({
    id: f.id,
    businessName: f.business_name,
    igUsername: f.ig_username,
    niche: f.niche,
    cuando: new Date(f.cuando),
    detalle: f.detalle,
    extra: f.extra,
  }))
}

/** Cuántos hay en cada pestaña, para el número al lado del nombre. */
export async function conteosDeFicha(
  setterId: string,
): Promise<Record<Exclude<SeccionFicha, 'resumen'>, number>> {
  const filas = await db.execute(sql`
    select
      (select count(*)::int from setter_sends ss
        where ss.setter_id = ${setterId}::uuid and ss.undone_at is null) as enviados,
      (select count(*)::int from lead_assignments la
        where la.setter_id = ${setterId}::uuid and la.respondido_at is not null
          and coalesce(la.respondio_a, 'primero') = 'primero') as primero,
      (select count(*)::int from lead_assignments la
        where la.setter_id = ${setterId}::uuid and la.respondio_a = 'segundo') as oferta,
      (select count(*)::int from meetings m
        where m.setter_id = ${setterId}::uuid) as reuniones
  `)

  const f = filas.rows[0] as
    | { enviados: number; primero: number; oferta: number; reuniones: number }
    | undefined

  return {
    enviados: f?.enviados ?? 0,
    primero: f?.primero ?? 0,
    oferta: f?.oferta ?? 0,
    reuniones: f?.reuniones ?? 0,
  }
}

/** Setters activos, para los selectores de reasignación y de mensajes. */
export async function listarSettersActivos(): Promise<
  Array<{ id: string; nombre: string; estado: UserStatus }>
> {
  const filas = await db.execute(sql`
    select s.id, u.name as nombre, u.status as estado
      from setters s join users u on u.id = s.user_id
     where u.status <> 'baja'
     order by u.name asc
  `)
  return filas.rows as Array<{ id: string; nombre: string; estado: UserStatus }>
}

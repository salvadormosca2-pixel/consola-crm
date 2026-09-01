/**
 * Cupo de las cuentas de Instagram de un setter.
 *
 * Lógica pura, sin base: es la parte que decide si el setter puede mandar otro
 * mensaje, con qué cuenta, y cuándo hay que frenarlo. Está separada del acceso
 * a datos a propósito, porque es la regla que no se negocia —nunca más de 30
 * por cuenta por día— y tiene que poder probarse exhaustivamente.
 *
 * Los leads son fríos y scrapeados: pasarse del cupo no cuesta un reto, cuesta
 * la cuenta.
 */

export interface CuentaDeSetter {
  id: string
  igUsername: string
  cupoDiario: number
  /** Mensajes ya mandados hoy con esta cuenta, recontados desde `setter_sends`. */
  enviadosHoy: number
  orden: number
  activa: boolean
}

export interface LecturaDeCuenta extends CuentaDeSetter {
  restante: number
  alTope: boolean
}

export interface EstadoDeCupo {
  cuentas: LecturaDeCuenta[]
  /** Con cuál está trabajando ahora. */
  activa: LecturaDeCuenta | null
  /** A cuál tiene que cambiar cuando la activa llegue al tope. */
  siguiente: LecturaDeCuenta | null
  /**
   * La cuenta activa llegó a su cupo y todavía le queda otra con lugar. La
   * pantalla se bloquea hasta que confirme el cambio: no alcanza con un aviso,
   * porque el aviso se ignora y la cuenta se restringe igual.
   */
  bloqueadoPorCambio: boolean
  /** No queda ninguna cuenta con cupo. Terminó por hoy. */
  terminoElDia: boolean
  /** Puede mandar ahora mismo. */
  puedeEnviar: boolean
  usadoHoy: number
  cupoTotal: number
  restanteTotal: number
}

/**
 * Estado del cupo de un setter.
 *
 * `activaId` es la cuenta que el setter confirmó estar usando en Instagram. Si
 * no confirmó ninguna, se toma la primera con cupo: al empezar el día no tiene
 * sentido pedirle que confirme algo que todavía no cambió.
 */
export function leerCupo(cuentas: CuentaDeSetter[], activaId: string | null): EstadoDeCupo {
  const lecturas: LecturaDeCuenta[] = [...cuentas]
    .sort((a, b) => a.orden - b.orden || a.igUsername.localeCompare(b.igUsername))
    .map((c) => {
      const restante = c.activa ? Math.max(c.cupoDiario - c.enviadosHoy, 0) : 0
      return { ...c, restante, alTope: c.activa && restante === 0 }
    })

  const utilizables = lecturas.filter((c) => c.activa)
  const conLugar = utilizables.filter((c) => c.restante > 0)

  const confirmada = activaId ? (lecturas.find((c) => c.id === activaId) ?? null) : null
  /*
   * Si la confirmada ya no sirve (la borré, la desactivé) se cae a la primera
   * con lugar. Si la confirmada está al tope se mantiene como activa: es
   * justamente el caso que tiene que bloquear la pantalla, no resolverse solo.
   */
  const activa =
    confirmada && confirmada.activa ? confirmada : (conLugar[0] ?? utilizables[0] ?? null)

  const siguiente = conLugar.find((c) => c.id !== activa?.id) ?? null

  const cupoTotal = utilizables.reduce((a, c) => a + c.cupoDiario, 0)
  const usadoHoy = utilizables.reduce((a, c) => a + c.enviadosHoy, 0)
  const restanteTotal = utilizables.reduce((a, c) => a + c.restante, 0)

  const alTope = activa !== null && activa.restante === 0
  const terminoElDia = restanteTotal === 0

  return {
    cuentas: lecturas,
    activa,
    siguiente,
    bloqueadoPorCambio: alTope && siguiente !== null,
    terminoElDia,
    puedeEnviar: activa !== null && activa.restante > 0,
    usadoHoy,
    cupoTotal,
    restanteTotal,
  }
}

/**
 * Cuántos leads tiene sentido entregarle ahora.
 *
 * Nunca más de lo que sus cuentas pueden abrir hoy: entregar leads sin cupo es
 * entregarle una forma de quemarse la cuenta. Tampoco más que su tanda diaria,
 * ni más de los que ya tiene sin trabajar.
 *
 * Los seguimientos ya no se descuentan. El cupo es el presupuesto de **abrir
 * chats nuevos** y un seguimiento no abre ninguno: restarlos hacía que el que
 * mejor trabajaba a los que le contestaron recibiera menos leads nuevos,
 * castigando exactamente lo que hay que premiar.
 */
export function cuantosEntregar(params: {
  estado: EstadoDeCupo
  tandaDiaria: number
  /** Leads que ya tiene asignados y sin contactar. Cada uno se va a llevar una apertura. */
  pendientes: number
}): number {
  const { estado, tandaDiaria, pendientes } = params
  const porCupo = estado.restanteTotal - pendientes
  const porTanda = tandaDiaria - pendientes
  return Math.max(Math.min(porCupo, porTanda), 0)
}

/** Texto del cartel de cambio de cuenta. El motivo va escrito, no implícito. */
export function motivoDelCambio(estado: EstadoDeCupo): string {
  const cupo = estado.activa?.cupoDiario ?? 30
  return `Pasar de ${cupo} mensajes por cuenta en un día es lo que hace que Instagram restrinja la cuenta.`
}

import { OPS_TZ } from './tz'

/**
 * Horas hábiles entre dos instantes.
 *
 * Existe por el SLA de la cola de clasificación: "más de 4 horas sin
 * clasificar" tiene que ser cuatro horas de trabajo, no cuatro de reloj. Un
 * lead que contestó a las once de la noche no está atrasado a las tres de la
 * mañana; contarlo así llenaría la pantalla de rojo todas las madrugadas y el
 * rojo dejaría de significar algo.
 *
 * Se razona en la zona de operación, igual que los cupos. Argentina no tiene
 * horario de verano —el offset es fijo—, así que convertir a hora local y hacer
 * la cuenta sobre esa hora de pared da el resultado exacto sin arrastrar una
 * librería de zonas horarias.
 */

export interface VentanaHabil {
  /** 'HH:mm' en que arranca el día de trabajo. */
  desde: string
  /** 'HH:mm' en que termina. */
  hasta: string
  /** Los domingos no se trabaja, igual que no se envía. */
  sinDomingos: boolean
}

export const VENTANA_HABIL: VentanaHabil = { desde: '09:00', hasta: '21:00', sinDomingos: true }

const MINUTO = 60_000
const DIA = 1_440

function minutosDelDia(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':')
  return Number(h) * 60 + Number(m)
}

/**
 * El instante, visto como hora de pared en la zona de operación.
 *
 * Devuelve los minutos desde una época arbitraria pero consistente, más el día
 * de la semana. Con eso alcanza: lo único que se hace después es restar.
 */
function horaDePared(at: Date, timeZone: string): { minutos: number; diaSemana: number } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at)

  const tomar = (tipo: string): number => Number(partes.find((p) => p.type === tipo)?.value ?? 0)
  // `hour12: false` puede devolver 24 a la medianoche en algunos entornos.
  const hora = tomar('hour') % 24

  const utc = Date.UTC(tomar('year'), tomar('month') - 1, tomar('day'), hora, tomar('minute'))
  return { minutos: Math.floor(utc / MINUTO), diaSemana: new Date(utc).getUTCDay() }
}

/**
 * Minutos hábiles entre dos instantes. Si `hasta` es anterior a `desde`, cero.
 *
 * Recorre día por día e intersecta cada uno con la ventana. Son pocos días en
 * la práctica —un lead sin clasificar hace un mes ya no es un problema de
 * SLA—, y el tope de un año evita que un dato corrupto cuelgue el servidor.
 */
export function minutosHabilesEntre(
  desde: Date,
  hasta: Date,
  ventana: VentanaHabil = VENTANA_HABIL,
  timeZone: string = OPS_TZ,
): number {
  const a = horaDePared(desde, timeZone)
  const b = horaDePared(hasta, timeZone)
  if (b.minutos <= a.minutos) return 0

  const abre = minutosDelDia(ventana.desde)
  const cierra = minutosDelDia(ventana.hasta)
  if (cierra <= abre) return 0

  // Medianoche del día de `desde`, en hora de pared.
  let dia = a.minutos - (((a.minutos % DIA) + DIA) % DIA)
  let diaSemana = a.diaSemana
  let total = 0

  for (let i = 0; dia <= b.minutos && i < 366; i += 1) {
    if (!(ventana.sinDomingos && diaSemana === 0)) {
      const inicio = Math.max(dia + abre, a.minutos)
      const fin = Math.min(dia + cierra, b.minutos)
      if (fin > inicio) total += fin - inicio
    }
    dia += DIA
    diaSemana = (diaSemana + 1) % 7
  }

  return total
}

export function horasHabilesEntre(
  desde: Date,
  hasta: Date = new Date(),
  ventana: VentanaHabil = VENTANA_HABIL,
  timeZone: string = OPS_TZ,
): number {
  return minutosHabilesEntre(desde, hasta, ventana, timeZone) / 60
}

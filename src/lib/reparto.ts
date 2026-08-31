/**
 * Cómo se reparten los leads del pozo entre los setters.
 *
 * Lógica pura, sin base, para poder probarla a fondo: es la que decide cuántos
 * leads le toca a cada uno, y equivocarse acá significa o dejar gente sin
 * trabajo o entregarle a alguien más leads de los que puede mandar sin quemar
 * su cuenta de Instagram.
 *
 * La regla de fondo es una sola: **nadie recibe más de lo que puede mandar
 * hoy**. Todo lo demás sale de ahí.
 */

export interface CapacidadDeSetter {
  setterId: string
  nombre: string
  /** Mensajes que todavía puede mandar hoy sumando sus cuentas de Instagram. */
  cupoRestante: number
  /** Techo propio de leads por día, configurado en su ficha. */
  tandaDiaria: number
  /** Leads que ya tiene asignados y todavía no contactó. */
  pendientes: number
  /** Segundos mensajes que le tocan hoy. También consumen cupo. */
  seguimientos: number
  /**
   * Cuántas cuentas de Instagram prendidas tiene.
   *
   * Se mira aparte del cupo aunque sin cuentas el cupo sea cero igual: cero por
   * no tener ninguna y cero por haber llegado al límite del día son dos
   * situaciones distintas —una se arregla cargando una cuenta, la otra
   * esperando a mañana— y el panel tiene que poder decir cuál es.
   */
  cuentas: number
  /** Pausado o de baja: no recibe nada. */
  activo: boolean
}

export interface Tajada {
  setterId: string
  nombre: string
  cantidad: number
  /** Cuánto más podría haber recibido si hubiera leads de sobra. */
  capacidad: number
  /** Por qué le toca esa cantidad. Un cero sin explicación no sirve. */
  motivo: string
}

export interface PlanDeReparto {
  tajadas: Tajada[]
  /** Cuántos leads se van a entregar en total. */
  total: number
  /** Cuántos quedan en el pozo después de repartir. */
  sobran: number
  /** Capacidad libre que no se pudo llenar porque no alcanzan los leads. */
  faltan: number
}

/**
 * Cuántos leads más puede recibir un setter hoy.
 *
 * Se descuentan los seguimientos porque salen de la misma cuenta y del mismo
 * cupo: entregarle 30 leads nuevos a alguien que además tiene 20 seguimientos
 * pendientes es pedirle que mande 50 desde un perfil que aguanta 30.
 */
export function capacidadDe(s: CapacidadDeSetter): { capacidad: number; motivo: string } {
  if (!s.activo) return { capacidad: 0, motivo: 'Está pausado: no recibe leads nuevos.' }

  /*
   * Sin cuenta de Instagram no se le entrega nada, y no es un tecnicismo:
   * entregarle leads sería sacarlos del pozo y dejarlos tomados 48 horas en la
   * cola de alguien que no tiene con qué escribir. Es lo que pasa el primer día
   * después de dar de alta al equipo, así que el motivo dice qué hacer.
   */
  if (s.cuentas === 0) {
    return { capacidad: 0, motivo: 'Todavía no tiene ninguna cuenta de Instagram cargada.' }
  }

  const porCupo = s.cupoRestante - s.seguimientos
  if (porCupo <= 0) {
    return {
      capacidad: 0,
      motivo:
        s.cupoRestante <= 0
          ? 'Sus cuentas llegaron al límite de hoy.'
          : `Lo que le queda de cupo se lo llevan sus ${s.seguimientos} seguimientos.`,
    }
  }

  const porTanda = s.tandaDiaria - s.pendientes
  if (porTanda <= 0) {
    return {
      capacidad: 0,
      motivo: `Ya tiene ${s.pendientes} leads sin contactar: llegó a su tanda del día.`,
    }
  }

  const capacidad = Math.min(porCupo, porTanda)
  const limita = porCupo < porTanda ? 'el cupo de sus cuentas' : 'su tanda diaria'
  return { capacidad, motivo: `Puede con ${capacidad} más; lo limita ${limita}.` }
}

/**
 * Arma el plan de reparto.
 *
 * Cuando hay leads de sobra, cada uno recibe toda su capacidad. Cuando no
 * alcanzan, se reparten **en proporción a la capacidad**: el que puede mandar
 * 60 recibe el doble que el que puede mandar 30. No en partes iguales, porque
 * eso le deja leads sin trabajar al que tiene una sola cuenta y desaprovecha al
 * que tiene dos.
 *
 * El resto de la división se asigna por el método del resto mayor, así la suma
 * da exacta y el reparto es siempre el mismo con los mismos números.
 */
export function planificarReparto(
  setters: CapacidadDeSetter[],
  disponibles: number,
): PlanDeReparto {
  const conCapacidad = setters.map((s) => ({ s, ...capacidadDe(s) }))
  const capacidadTotal = conCapacidad.reduce((a, c) => a + c.capacidad, 0)
  const aRepartir = Math.max(0, Math.min(disponibles, capacidadTotal))

  const base = conCapacidad.map((c) => {
    const exacto = capacidadTotal > 0 ? (c.capacidad / capacidadTotal) * aRepartir : 0
    return { ...c, exacto, entero: Math.floor(exacto) }
  })

  let repartido = base.reduce((a, b) => a + b.entero, 0)
  const restantes = aRepartir - repartido

  /*
   * Los que quedaron con la fracción más grande se llevan las unidades
   * sueltas. Sin esto, repartir 10 entre tres capacidades iguales entregaría
   * 9 y dejaría uno colgado en el pozo sin motivo.
   */
  const orden = [...base]
    .map((b, i) => ({ i, resto: b.exacto - b.entero, capacidad: b.capacidad }))
    .filter((x) => x.capacidad > 0)
    .sort((a, b) => b.resto - a.resto || a.i - b.i)

  const extra = new Map<number, number>()
  for (let k = 0; k < restantes; k++) {
    const elegido = orden[k % orden.length]
    if (!elegido) break
    extra.set(elegido.i, (extra.get(elegido.i) ?? 0) + 1)
  }

  const tajadas: Tajada[] = base.map((b, i) => {
    const cantidad = Math.min(b.entero + (extra.get(i) ?? 0), b.capacidad)
    return {
      setterId: b.s.setterId,
      nombre: b.s.nombre,
      cantidad,
      capacidad: b.capacidad,
      motivo:
        b.capacidad === 0
          ? b.motivo
          : cantidad === b.capacidad
            ? `Se lleva todo lo que puede: ${cantidad}.`
            : `Le tocan ${cantidad} de los ${b.capacidad} que podría hacer: no alcanzan los leads.`,
    }
  })

  repartido = tajadas.reduce((a, t) => a + t.cantidad, 0)

  return {
    tajadas,
    total: repartido,
    sobran: Math.max(disponibles - repartido, 0),
    faltan: Math.max(capacidadTotal - repartido, 0),
  }
}

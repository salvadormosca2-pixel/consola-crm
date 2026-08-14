import { z } from 'zod'

/**
 * Perfil de voz: cómo hablás vos.
 *
 * Los mensajes tienen que sonar a la persona, no a campaña. Esto es lo que
 * separa un seguimiento que la gente contesta de uno que reportan — y según tu
 * propia spec, el mejor antibaneo es que la gente conteste.
 *
 * Se usa en dos lados: alimenta las variables {{mi_nombre}} y {{oferta}}, y se
 * muestra al costado del editor de plantillas como guía mientras escribís.
 */

export const VOICE_KEY = 'voz'

export const voiceSchema = z.object({
  /** Con qué nombre firmás. Alimenta {{mi_nombre}}. */
  miNombre: z.string().trim().max(60).default(''),
  /** Cómo se llama lo que estás ofreciendo. Alimenta {{oferta}}. */
  oferta: z.string().trim().max(120).default(''),

  /** Cómo arrancás un mensaje. Ej: "Hola X, ¿cómo va?" */
  saludo: z.string().trim().max(200).default(''),
  /** Cómo cerrás. Ej: "Cualquier cosa me escribís" */
  cierre: z.string().trim().max(200).default(''),

  /**
   * Palabras y giros que sí usás. Es lo que le da textura al mensaje:
   * "dale", "che", "posta", "buenísimo".
   */
  expresiones: z.array(z.string().trim().max(40)).max(30).default([]),

  /**
   * Palabras que NO usás nunca. Suelen ser las que delatan una plantilla:
   * "estimado", "aprovecho para", "no dude en contactarnos".
   */
  prohibidas: z.array(z.string().trim().max(40)).max(30).default([]),

  /** De usted o de vos. En Argentina casi siempre de vos. */
  tuteo: z.enum(['vos', 'usted']).default('vos'),

  /** Qué tan largos son tus mensajes. */
  largo: z.enum(['corto', 'medio', 'largo']).default('corto'),

  /** Usás emojis o no. */
  emojis: z.enum(['nunca', 'pocos', 'varios']).default('pocos'),

  /**
   * Mensajes reales tuyos, pegados tal cual. Es lo más útil de todo: una
   * descripción del tono se interpreta de diez maneras, un mensaje real no.
   */
  ejemplos: z.array(z.string().trim().max(1000)).max(10).default([]),

  /** Cualquier otra cosa que haya que saber para escribir como vos. */
  notas: z.string().trim().max(2000).default(''),
})

export type PerfilDeVoz = z.infer<typeof voiceSchema>

export const VOZ_VACIA: PerfilDeVoz = voiceSchema.parse({})

export const LARGO_META: Record<PerfilDeVoz['largo'], string> = {
  corto: 'Una o dos líneas',
  medio: 'Tres o cuatro líneas',
  largo: 'Un párrafo completo',
}

export const EMOJI_META: Record<PerfilDeVoz['emojis'], string> = {
  nunca: 'Sin emojis',
  pocos: 'Alguno suelto',
  varios: 'Varios',
}

/** Qué tan completo está el perfil, para empujar a terminarlo. */
export function completitudDeVoz(v: PerfilDeVoz): { hechos: number; total: number; falta: string[] } {
  const items: Array<[boolean, string]> = [
    [v.miNombre.length > 0, 'Tu nombre'],
    [v.oferta.length > 0, 'Qué estás ofreciendo'],
    [v.saludo.length > 0, 'Cómo saludás'],
    [v.cierre.length > 0, 'Cómo cerrás'],
    [v.expresiones.length > 0, 'Expresiones que usás'],
    [v.prohibidas.length > 0, 'Palabras que no usás'],
    [v.ejemplos.length > 0, 'Al menos un mensaje real tuyo'],
  ]
  return {
    hechos: items.filter(([ok]) => ok).length,
    total: items.length,
    falta: items.filter(([ok]) => !ok).map(([, label]) => label),
  }
}

/**
 * Revisa un texto contra el perfil y devuelve avisos.
 *
 * No corrige ni reescribe: señala. La decisión de qué decir es de la persona,
 * pero si escribiste "estimado" habiendo declarado que nunca lo usás, conviene
 * que lo veas antes de mandarlo 300 veces.
 */
export function revisarContraVoz(texto: string, v: PerfilDeVoz): string[] {
  const avisos: string[] = []
  const plano = texto.toLowerCase()

  for (const palabra of v.prohibidas) {
    if (palabra.length >= 3 && plano.includes(palabra.toLowerCase())) {
      avisos.push(`Dice «${palabra}», y marcaste que no usás esa palabra.`)
    }
  }

  if (v.tuteo === 'vos' && /\b(usted|ustedes|su empresa|le escribo)\b/.test(plano)) {
    avisos.push('Está escrito de usted y vos hablás de vos.')
  }

  const emojis = (texto.match(/\p{Extended_Pictographic}/gu) ?? []).length
  if (v.emojis === 'nunca' && emojis > 0) {
    avisos.push('Tiene emojis y marcaste que no usás.')
  }
  if (v.emojis === 'pocos' && emojis > 2) {
    avisos.push(`Tiene ${emojis} emojis; marcaste que usás alguno suelto.`)
  }

  const lineas = texto.split(/\n+/).filter((l) => l.trim().length > 0).length
  const largo = texto.length
  if (v.largo === 'corto' && largo > 320) {
    avisos.push('Es más largo de lo que dijiste que escribís. Los mensajes largos se leen menos.')
  }
  if (v.largo === 'corto' && lineas > 3) {
    avisos.push('Tiene más líneas de las que solés mandar.')
  }

  return avisos
}

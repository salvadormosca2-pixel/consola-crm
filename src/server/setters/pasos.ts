import 'server-only'

import { sql } from 'drizzle-orm'

import { PASOS_DE_PISTA } from '@/lib/pistas'

/**
 * Los pasos que hoy existen en el recorrido, para poder filtrarlos en SQL.
 *
 * Las colas tienen que mirarlo. Un lead puede tener guardado un paso que ya
 * salió del modelo —hay trece retirados, del tiempo de la oferta y las dos
 * escaleras— y ese lead no se puede trabajar de ninguna manera: nadie puede
 * escribirle un texto para un paso que la pantalla de Textos ya no ofrece. Sin
 * este filtro aparece en el celular del setter bloqueado para siempre.
 *
 * Se arma con `sql.join` y no interpolando el arreglo: drizzle bindea un array
 * de JavaScript como un parámetro solo, y `in ($1)` no compara contra la lista.
 */
export const PASOS_VIGENTES = sql.join(
  PASOS_DE_PISTA.map((p) => sql`${p}`),
  sql`, `,
)

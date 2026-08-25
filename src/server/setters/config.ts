import 'server-only'

import { sql } from 'drizzle-orm'

import { db, type Ejecutor } from '@/db'
import {
  SETTERS_CONFIG_DEFAULT,
  SETTERS_CONFIG_KEY,
  settersConfigSchema,
  type SettersConfig,
} from '@/lib/setters-config'

/**
 * Los tiempos de la operación, guardados y editables.
 *
 * Antes vivían fijos en el código. Son tres decisiones que cambian según cómo
 * responda tu mercado y no deberían necesitar un despliegue:
 *
 *   · a las cuántas horas del primer mensaje sale el segundo,
 *   · cuántas horas tiene un setter antes de que el lead vuelva al pozo,
 *   · con cuántos días de atraso me llega la alerta.
 */
export async function leerConfigSetters(cliente: Ejecutor = db): Promise<SettersConfig> {
  const filas = await cliente.execute(sql`
    select value_jsonb from settings where key = ${SETTERS_CONFIG_KEY} limit 1
  `)
  const valor = (filas.rows[0] as { value_jsonb: unknown } | undefined)?.value_jsonb
  if (!valor) return SETTERS_CONFIG_DEFAULT

  // Se completa con los defaults: agregar una opción nueva no invalida lo
  // guardado, simplemente arranca con su valor por defecto.
  const parsed = settersConfigSchema.safeParse({ ...SETTERS_CONFIG_DEFAULT, ...(valor as object) })
  return parsed.success ? parsed.data : SETTERS_CONFIG_DEFAULT
}

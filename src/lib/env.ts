import { z } from 'zod'

/**
 * Validación del entorno de servidor. Si falta algo, la app no arranca:
 * es preferible fallar en el arranque que descubrirlo a mitad de una importación.
 * Ninguna de estas variables puede llevar prefijo NEXT_PUBLIC_.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, 'Falta DATABASE_URL. Copiá .env.example a .env.local.'),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET tiene que tener al menos 32 caracteres. Generalo con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'),
  OPS_TIMEZONE: z.string().default('America/Argentina/Catamarca'),
  /**
   * Clave con la que se cifran las credenciales guardadas en la base (token de
   * Chatwoot, tokens de instancia de Evolution). 32 bytes en base64.
   */
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message:
        'ENCRYPTION_KEY tiene que ser de 32 bytes en base64. Generala con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    }),
})

let cached: z.infer<typeof schema> | null = null

export function env(): z.infer<typeof schema> {
  if (cached) return cached
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const detalle = parsed.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Configuración de entorno inválida:\n${detalle}`)
  }
  cached = parsed.data
  return cached
}

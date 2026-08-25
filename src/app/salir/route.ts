import { redirect } from 'next/navigation'

import { signOut } from '@/auth'

/**
 * Salida por GET.
 *
 * Existe para un caso puntual: la cookie todavía es válida pero la persona ya
 * no puede trabajar (la pausé, la di de baja, cerré sus sesiones). Mandarla
 * directo a `/ingresar` sería un rebote infinito, porque el portero ve un token
 * bueno y la devuelve a la app. Acá la cookie se borra primero.
 */
export async function GET(request: Request): Promise<never> {
  const motivo = new URL(request.url).searchParams.get('motivo')
  await signOut({ redirect: false })
  redirect(motivo ? `/ingresar?motivo=${encodeURIComponent(motivo)}` : '/ingresar')
}

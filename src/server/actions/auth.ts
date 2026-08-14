'use server'

import { AuthError } from 'next-auth'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { signIn, signOut } from '@/auth'

const schema = z.object({
  email: z.string().min(1, 'Escribí tu email.').email('Ese email no tiene formato válido.'),
  password: z.string().min(1, 'Escribí tu contraseña.'),
})

export type EstadoIngreso = { error: string | null }

export async function ingresar(
  _prev: EstadoIngreso,
  formData: FormData,
): Promise<EstadoIngreso> {
  const parsed = schema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }
  }

  try {
    await signIn('credentials', { ...parsed.data, redirect: false })
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: 'Email o contraseña incorrectos.' }
    }
    // Falla de conexión a la base, entorno mal configurado, etc.
    console.error('Error al ingresar:', err)
    return { error: 'No pude conectar con la base. Revisá que Postgres esté levantado.' }
  }

  redirect('/contactos')
}

export async function salir(): Promise<void> {
  await signOut({ redirectTo: '/ingresar' })
}

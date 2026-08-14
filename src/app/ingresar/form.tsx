'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Panel } from '@/components/ui/panel'
import { ingresar, type EstadoIngreso } from '@/server/actions/auth'

const INICIAL: EstadoIngreso = { error: null }

export function FormularioIngreso() {
  const [estado, action] = useActionState(ingresar, INICIAL)

  return (
    <Panel className="p-4">
      <form action={action} className="space-y-3">
        <Field label="Email">
          <Input
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            placeholder="vos@ejemplo.com"
          />
        </Field>

        <Field label="Contraseña">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>

        {estado.error ? (
          <p role="alert" className="rounded-[4px] border border-rojo/35 bg-rojo/10 px-2 py-1.5 text-[11.5px] text-rojo">
            {estado.error}
          </p>
        ) : null}

        <Boton />
      </form>

      <p className="mt-3 border-t border-borde pt-3 text-[11px] leading-relaxed text-texto-2">
        No hay registro. Las cuentas se crean desde la terminal con{' '}
        <code className="dato text-texto">npm run user:create</code>.
      </p>
    </Panel>
  )
}

function Boton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="primaria" size="lg" className="w-full" disabled={pending}>
      {pending ? 'Entrando…' : 'Entrar'}
    </Button>
  )
}

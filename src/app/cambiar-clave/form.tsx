'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { rutaInicial } from '@/auth.config'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Panel } from '@/components/ui/panel'
import type { UserRole } from '@/db/enums'
import { cambiarPassword, type EstadoClave } from '@/server/actions/auth'

const INICIAL: EstadoClave = { ok: false, error: null }

export function FormularioClave({ obligatorio, rol }: { obligatorio: boolean; rol: UserRole }) {
  const [estado, action] = useActionState(cambiarPassword, INICIAL)

  return (
    <Panel className="p-4">
      <form action={action} className="space-y-3">
        <Field label={obligatorio ? 'Contraseña temporal' : 'Contraseña actual'}>
          <Input
            name="actual"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            className="h-10 text-[16px]"
          />
        </Field>

        <Field label="Contraseña nueva">
          <Input
            name="nueva"
            type="password"
            autoComplete="new-password"
            required
            className="h-10 text-[16px]"
          />
        </Field>

        <Field label="Repetila">
          <Input
            name="repetir"
            type="password"
            autoComplete="new-password"
            required
            className="h-10 text-[16px]"
          />
        </Field>

        {estado.error ? (
          <p
            role="alert"
            className="rounded-[4px] border border-rojo/35 bg-rojo-tenue px-2 py-1.5 text-[11.5px] text-rojo"
          >
            {estado.error}
          </p>
        ) : null}

        <Boton />
      </form>

      {!obligatorio ? (
        <Link
          href={rutaInicial(rol)}
          className="mt-3 block border-t border-borde pt-3 text-[11.5px] text-texto-2 hover:text-texto"
        >
          Volver sin cambiar nada
        </Link>
      ) : null}
    </Panel>
  )
}

function Boton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="primaria" size="lg" className="h-11 w-full" disabled={pending}>
      {pending ? 'Guardando…' : 'Guardar y entrar'}
    </Button>
  )
}

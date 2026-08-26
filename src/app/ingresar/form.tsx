'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { CampoClave } from '@/components/ui/campo-clave'
import { Panel } from '@/components/ui/panel'
import { ingresar, type EstadoIngreso } from '@/server/actions/auth'

const INICIAL: EstadoIngreso = { error: null }

export function FormularioIngreso({
  aviso,
  conAccesoRapido = false,
}: {
  aviso: string | null
  conAccesoRapido?: boolean
}) {
  const [estado, action] = useActionState(ingresar, INICIAL)
  // Con el acceso rápido arriba, el formulario deja de ser lo primero: se
  // guarda plegado para no tener tres cosas compitiendo en una pantalla chica.
  const [abierto, setAbierto] = useState(!conAccesoRapido)

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        className="w-full rounded-[6px] border border-borde bg-superficie px-3 py-2.5 text-[12.5px] text-texto-2 transition-colors duration-150 hover:text-texto"
      >
        Entrar con email y contraseña
      </button>
    )
  }

  return (
    <Panel className="p-4">
      {aviso ? (
        <p className="mb-3 rounded-[4px] border border-ambar/35 bg-ambar-tenue px-2 py-1.5 text-[11.5px] text-ambar">
          {aviso}
        </p>
      ) : null}

      <form action={action} className="space-y-3">
        <Field label="Email">
          <Input
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            inputMode="email"
            placeholder="vos@ejemplo.com"
            className="h-10 text-[16px]"
          />
        </Field>

        <Field label="Contraseña">
          <CampoClave
            name="password"
            autoComplete="current-password"
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

      <p className="mt-3 border-t border-borde pt-3 text-[11px] leading-relaxed text-texto-2">
        Si sos del equipo y perdiste el acceso, pedile al administrador que te restablezca la
        contraseña: te llega una nueva en el momento.
      </p>
    </Panel>
  )
}

function Boton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="primaria" size="lg" className="h-11 w-full" disabled={pending}>
      {pending ? 'Entrando…' : 'Entrar'}
    </Button>
  )
}

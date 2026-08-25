import type { Metadata } from 'next'

import { SETTERS_CONFIG_DEFAULT } from '@/lib/setters-config'
import { requerirSesion } from '@/server/session'

import { FormularioClave } from './form'

export const metadata: Metadata = { title: 'Cambiar contraseña · Ecosystem' }

export default async function PaginaCambiarClave() {
  const sesion = await requerirSesion()

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-[320px]">
        <div className="mb-5">
          <h1 className="text-[20px]">
            {sesion.debeCambiarPassword ? 'Elegí tu contraseña' : 'Cambiar contraseña'}
          </h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-texto-2">
            {sesion.debeCambiarPassword
              ? 'Entraste con una contraseña temporal. Elegí una tuya antes de empezar a trabajar: la temporal no se puede recuperar y solo la vio quien te dio el acceso.'
              : `Mínimo ${SETTERS_CONFIG_DEFAULT.largoMinimoPassword} caracteres.`}
          </p>
        </div>
        <FormularioClave obligatorio={sesion.debeCambiarPassword} rol={sesion.rol} />
      </div>
    </main>
  )
}

'use client'

import { KeyRound, LogOut, Pause, Play, Trash2, UserMinus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { TarjetaDeAcceso } from '@/components/tarjeta-acceso'
import { Button } from '@/components/ui/button'
import type { UserStatus } from '@/db/enums'
import {
  cerrarSesiones,
  darDeBaja,
  eliminarSetter,
  pausarSetter,
  reactivarSetter,
  restablecerPassword,
  type ResultadoRestablecer,
} from '@/server/actions/equipo'

/**
 * Lo que puedo hacer con una cuenta.
 *
 * Pausar y dar de baja son cosas distintas y no se pueden confundir: pausar es
 * "no trabajés por ahora", dar de baja es "no trabajás más". Las dos conservan
 * el historial y la comisión de lo que ya hizo; ninguna borra nada.
 *
 * Eliminar es la tercera, y es la única que borra: existe para el alta
 * equivocada —el mail mal tipeado, el que al final no entró, los que quedaron
 * de más en un alta por lote— y se apaga sola en cuanto la persona trabajó
 * aunque sea un lead. Cuando no se puede, el botón sigue ahí pero apagado de
 * color y contesta por qué al tocarlo: esconderlo —o deshabilitarlo, que lo
 * deja gris y mudo porque el `title` no aparece sobre un botón deshabilitado—
 * deja la pregunta "¿por qué no puedo borrarlo?" sin respuesta en ninguna
 * pantalla.
 */
export function Acciones({
  setterId,
  nombre,
  estado,
  esAdminMadre,
  sinHistorial,
}: {
  setterId: string
  nombre: string
  estado: UserStatus
  esAdminMadre: boolean
  /** Nunca mandó un mensaje ni consiguió una reunión: no hay nada que perder. */
  sinHistorial: boolean
}) {
  const router = useRouter()
  const [pendiente, iniciar] = React.useTransition()
  const [tarjeta, setTarjeta] = React.useState<
    Extract<ResultadoRestablecer, { ok: true }> | null
  >(null)
  const [confirmando, setConfirmando] = React.useState<'baja' | 'eliminar' | null>(null)

  function correr(fn: () => Promise<{ ok: boolean; error: string | null }>, exito: string): void {
    iniciar(async () => {
      const r = await fn()
      if (r.ok) {
        toast.success(exito)
        router.refresh()
      } else {
        toast.error(r.error ?? 'No se pudo.')
      }
    })
  }

  function borrar(): void {
    setConfirmando(null)
    iniciar(async () => {
      const r = await eliminarSetter(setterId)
      if (r.ok) {
        // La ficha que se está mirando dejó de existir: quedarse acá sería un
        // 404 al primer refresh. Se vuelve al equipo, que es donde se ve el
        // resultado.
        toast.success(`${nombre} se eliminó`)
        router.push('/equipo' as never)
        router.refresh()
      } else {
        toast.error(r.error ?? 'No se pudo eliminar.')
      }
    })
  }

  if (tarjeta) {
    return (
      <div className="w-full max-w-[420px]">
        <TarjetaDeAcceso {...tarjeta} titulo="Contraseña nueva" />
        <Button
          variant="fantasma"
          className="mt-2 w-full"
          onClick={() => {
            setTarjeta(null)
            router.refresh()
          }}
        >
          Listo, ya se la mandé
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {esAdminMadre ? (
        <Button
          variant="secundaria"
          disabled={pendiente}
          onClick={() =>
            iniciar(async () => {
              const r = await restablecerPassword(setterId)
              if (r.ok) setTarjeta(r)
              else toast.error(r.error)
            })
          }
        >
          <KeyRound aria-hidden />
          Restablecer contraseña
        </Button>
      ) : null}

      <Button
        variant="secundaria"
        disabled={pendiente}
        title="Por si perdió el celular: se cierran todas sus sesiones abiertas."
        onClick={() => correr(() => cerrarSesiones(setterId), 'Sesiones cerradas')}
      >
        <LogOut aria-hidden />
        Cerrar sus sesiones
      </Button>

      {estado === 'activo' ? (
        <Button
          variant="secundaria"
          disabled={pendiente}
          title="Deja de recibir leads y sus pendientes vuelven al pozo. Conserva su historial."
          onClick={() =>
            correr(() => pausarSetter(setterId), `${nombre} quedó pausado y sus leads volvieron al pozo`)
          }
        >
          <Pause aria-hidden />
          Pausar
        </Button>
      ) : estado === 'pausado' ? (
        <Button
          variant="positiva"
          disabled={pendiente}
          onClick={() => correr(() => reactivarSetter(setterId), `${nombre} vuelve a trabajar`)}
        >
          <Play aria-hidden />
          Reactivar
        </Button>
      ) : null}

      {esAdminMadre && estado !== 'baja' ? (
        confirmando === 'baja' ? (
          <div className="flex items-center gap-1.5 rounded-[5px] border border-rojo/35 bg-rojo-tenue px-2 py-1">
            <span className="text-[11.5px] text-texto-2">¿Dar de baja a {nombre}?</span>
            <Button
              variant="destructiva"
              size="sm"
              disabled={pendiente}
              onClick={() => {
                setConfirmando(null)
                correr(
                  () => darDeBaja(setterId),
                  `${nombre} quedó de baja. Su historial y su comisión siguen ahí.`,
                )
              }}
            >
              Sí, dar de baja
            </Button>
            <Button variant="fantasma" size="sm" onClick={() => setConfirmando(null)}>
              No
            </Button>
          </div>
        ) : (
          <Button
            variant="destructiva"
            disabled={pendiente}
            title="No puede entrar más. Sus leads sin contactar vuelven al pozo y su historial queda."
            onClick={() => setConfirmando('baja')}
          >
            <UserMinus aria-hidden />
            Dar de baja
          </Button>
        )
      ) : null}

      {esAdminMadre ? (
        confirmando === 'eliminar' ? (
          <div className="flex items-center gap-1.5 rounded-[5px] border border-rojo/35 bg-rojo-tenue px-2 py-1">
            <span className="text-[11.5px] text-texto-2">
              ¿Borrar a {nombre}? No se puede deshacer.
            </span>
            <Button variant="destructiva" size="sm" disabled={pendiente} onClick={borrar}>
              Sí, borrar
            </Button>
            <Button variant="fantasma" size="sm" onClick={() => setConfirmando(null)}>
              No
            </Button>
          </div>
        ) : (
          <Button
            variant={sinHistorial ? 'destructiva' : 'fantasma'}
            disabled={pendiente}
            title={
              sinHistorial
                ? 'Para el alta equivocada: se borra la cuenta, sus cuentas de Instagram y los leads que todavía no tocó vuelven al pozo.'
                : `${nombre} ya trabajó leads: borrarlo sería perder su historial y su comisión. Para que no entre más, dale de baja.`
            }
            onClick={() => {
              if (!sinHistorial) {
                toast.error(
                  `${nombre} ya trabajó leads: borrarlo sería perder su historial y su comisión. Dale de baja y no entra más.`,
                )
                return
              }
              setConfirmando('eliminar')
            }}
          >
            <Trash2 aria-hidden />
            Eliminar
          </Button>
        )
      ) : null}
    </div>
  )
}

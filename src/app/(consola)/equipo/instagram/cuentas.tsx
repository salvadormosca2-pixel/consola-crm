'use client'

import { Plus, Power, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Chip, Panel, PanelHeader } from '@/components/ui/panel'
import { normalizarInstagram } from '@/lib/equipo-lote'
import { guardarInstagram } from '@/server/actions/equipo'
import type { SetterConCuentas } from '@/server/setters/panel'

/**
 * Editar las cuentas de Instagram del equipo, y solo eso.
 *
 * Después de un alta en lote hay dieciséis setters que pueden entrar pero no
 * tienen con qué mandar: sin cuenta, el cupo es cero y el reparto los saltea.
 * Cargarlas abriendo dieciséis fichas —cada una con nombre, tanda, hora de
 * recordatorio y todo lo demás en pantalla— es donde la carga se abandona por
 * la mitad y quedan cuatro trabajando de dieciséis.
 *
 * Acá está el equipo entero en una lista, con un solo campo por cuenta. Nada de
 * lo otro se manda al servidor, así que no hay forma de pisar un nombre desde
 * esta pantalla sin querer.
 *
 * Lo único que se mueve solo es la tanda del día, que pasa a ser la suma de los
 * cupos de sus cuentas prendidas. Es lo que uno espera al sumar una segunda
 * cuenta —"ahora puede con 30 más"— y sin eso el cupo alcanzaba pero la tanda
 * no, así que se sumaba la cuenta y no le llegaba ni un lead nuevo.
 */

interface CuentaEnPantalla {
  /** null = todavía no existe en la base. */
  id: string | null
  usuario: string
  cupo: string
  activa: boolean
}

export function Cuentas({
  equipo,
  cupoPorDefecto,
}: {
  equipo: SetterConCuentas[]
  cupoPorDefecto: number
}) {
  const sinCuenta = equipo.filter((s) => !s.cuentas.some((c) => c.activa)).length

  return (
    <div className="space-y-3">
      {sinCuenta > 0 ? (
        <Panel className="border-ambar/40">
          <p className="px-3 py-2.5 text-[12.5px] leading-relaxed text-texto-2">
            <strong className="font-semibold text-ambar">
              {sinCuenta} {sinCuenta === 1 ? 'setter' : 'setters'} sin cuenta prendida.
            </strong>{' '}
            Mientras no tengan una, su cupo es cero y el reparto no les entrega leads.
          </p>
        </Panel>
      ) : null}

      {equipo.map((setter) => (
        /*
         * La clave lleva las cuentas adentro a propósito: cuando el guardado
         * termina y el servidor vuelve con los ids nuevos, la tarjeta se
         * remonta y el estado local arranca de lo que quedó guardado. Sin eso
         * la pantalla seguiría creyendo que esa cuenta no existe todavía y el
         * segundo guardado la insertaría de nuevo.
         */
        <FichaDeCuentas
          key={`${setter.setterId}:${JSON.stringify(setter.cuentas)}`}
          setter={setter}
          cupoPorDefecto={cupoPorDefecto}
        />
      ))}
    </div>
  )
}

function FichaDeCuentas({
  setter,
  cupoPorDefecto,
}: {
  setter: SetterConCuentas
  cupoPorDefecto: number
}) {
  const router = useRouter()
  const [pendiente, iniciar] = React.useTransition()

  const guardadas = React.useMemo<CuentaEnPantalla[]>(
    () =>
      setter.cuentas.map((c) => ({
        id: c.id,
        usuario: c.igUsername,
        cupo: String(c.cupoDiario),
        activa: c.activa,
      })),
    [setter.cuentas],
  )

  const [cuentas, setCuentas] = React.useState<CuentaEnPantalla[]>(guardadas)
  const sucio = JSON.stringify(cuentas) !== JSON.stringify(guardadas)

  function cambiar(i: number, cambio: Partial<CuentaEnPantalla>): void {
    setCuentas((cs) => cs.map((c, j) => (j === i ? { ...c, ...cambio } : c)))
  }

  function guardar(): void {
    const listas = cuentas.filter((c) => c.usuario.trim().length > 0)
    if (listas.some((c) => Number(c.cupo) < 1)) {
      toast.error('El cupo tiene que ser al menos 1.')
      return
    }

    iniciar(async () => {
      const r = await guardarInstagram({
        setterId: setter.setterId,
        cuentas: listas.map((c) => ({
          id: c.id,
          usuario: normalizarInstagram(c.usuario),
          cupo: Number(c.cupo),
          activa: c.activa,
        })),
      })

      if (r.ok) {
        toast.success(`Cuentas de ${setter.nombre} guardadas.`)
        // Las recién creadas vuelven con su id: sin esto, guardar dos veces
        // seguidas insertaría la misma cuenta otra vez.
        router.refresh()
      } else {
        toast.error(r.error ?? 'No se pudieron guardar las cuentas.')
      }
    })
  }

  const prendidas = cuentas.filter((c) => c.activa && c.usuario.trim().length > 0).length

  return (
    <Panel>
      <PanelHeader
        titulo={setter.nombre}
        descripcion={setter.email}
        acciones={
          prendidas === 0 ? (
            <Chip tono="activo">Sin cuenta</Chip>
          ) : (
            <Chip tono="positivo">
              {prendidas} {prendidas === 1 ? 'cuenta' : 'cuentas'}
            </Chip>
          )
        }
      />

      <div className="space-y-2 px-3 py-3">
        {cuentas.length === 0 ? (
          <p className="text-[12.5px] text-texto-2">
            Todavía no tiene ninguna. Agregale la cuenta con la que va a escribir.
          </p>
        ) : null}

        {cuentas.map((cuenta, i) => (
          <div key={cuenta.id ?? `nueva-${i}`} className="flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <span className="dato pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12.5px] text-texto-2">
                @
              </span>
              <Input
                value={cuenta.usuario}
                onChange={(e) => cambiar(i, { usuario: e.target.value })}
                placeholder="cuenta_de_instagram"
                aria-label={`Cuenta de Instagram de ${setter.nombre}`}
                spellCheck={false}
                className={'pl-5 ' + (cuenta.activa ? '' : 'opacity-55')}
              />
            </div>

            <Input
              type="number"
              min={1}
              max={100}
              value={cuenta.cupo}
              onChange={(e) => cambiar(i, { cupo: e.target.value })}
              aria-label="Mensajes por día"
              className="w-[72px] shrink-0"
            />

            {cuenta.id ? (
              <Button
                variant={cuenta.activa ? 'fantasma' : 'contorno'}
                size="icono"
                aria-label={cuenta.activa ? 'Apagar la cuenta' : 'Prender la cuenta'}
                title={cuenta.activa ? 'Apagar: deja de recibir reparto' : 'Volver a prenderla'}
                onClick={() => cambiar(i, { activa: !cuenta.activa })}
              >
                <Power aria-hidden />
              </Button>
            ) : (
              <Button
                variant="fantasma"
                size="icono"
                aria-label="Quitar esta cuenta"
                onClick={() => setCuentas((cs) => cs.filter((_, j) => j !== i))}
              >
                <X aria-hidden />
              </Button>
            )}
          </div>
        ))}

        {cuentas.length < 5 ? (
          <Button
            variant="fantasma"
            size="sm"
            onClick={() =>
              setCuentas((cs) => [
                ...cs,
                { id: null, usuario: '', cupo: String(cupoPorDefecto), activa: true },
              ])
            }
          >
            <Plus aria-hidden />
            Agregar cuenta
          </Button>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-borde px-3 py-2">
        <span className="text-[11px] leading-relaxed text-texto-2/80">
          Más de 30 por cuenta en un día es lo que hace que Instagram la restrinja.
        </span>
        <Button variant="primaria" size="sm" disabled={!sucio || pendiente} onClick={guardar}>
          {pendiente ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </Panel>
  )
}

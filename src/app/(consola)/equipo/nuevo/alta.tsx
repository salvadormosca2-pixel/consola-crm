'use client'

import { Plus, X } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'
import { toast } from 'sonner'

import { TarjetaDeAcceso } from '@/components/tarjeta-acceso'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { crearSetter, type TarjetaDeAlta } from '@/server/actions/equipo'

/**
 * Formulario corto: nombre, email, cuentas de Instagram con su cupo, y tamaño
 * de tanda. Nada más. Cada campo de más en un alta es un campo que se completa
 * mal la primera vez y no se corrige nunca.
 */
interface CuentaEnEdicion {
  usuario: string
  cupo: string
}

export function Alta({ cupoPorDefecto }: { cupoPorDefecto: number }) {
  const [nombre, setNombre] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [cuentas, setCuentas] = React.useState<CuentaEnEdicion[]>([
    { usuario: '', cupo: String(cupoPorDefecto) },
  ])
  const [tandaManual, setTandaManual] = React.useState<string | null>(null)
  const [pendiente, iniciar] = React.useTransition()
  const [tarjeta, setTarjeta] = React.useState<TarjetaDeAlta | null>(null)

  // La tanda por defecto es el cupo total de sus cuentas: entregarle más leads
  // que mensajes puede mandar es entregarle una forma de quemarse la cuenta.
  const cupoTotal = cuentas.reduce((a, c) => a + (Number(c.cupo) || 0), 0)
  const tanda = tandaManual ?? String(cupoTotal || cupoPorDefecto)

  function guardar(): void {
    iniciar(async () => {
      const r = await crearSetter({
        nombre,
        email,
        tanda: Number(tanda),
        cuentas: cuentas
          .filter((c) => c.usuario.trim().length > 0)
          .map((c) => ({ usuario: c.usuario, cupo: Number(c.cupo) })),
      })

      if (r.ok) setTarjeta(r)
      else toast.error(r.error)
    })
  }

  if (tarjeta) {
    return (
      <div className="space-y-3">
        <TarjetaDeAcceso {...tarjeta} />
        <div className="flex gap-2">
          <Button asChild variant="secundaria" size="lg" className="flex-1">
            <Link href={`/equipo/${tarjeta.setterId}` as never}>Ver su ficha</Link>
          </Button>
          <Button asChild variant="fantasma" size="lg" className="flex-1">
            <Link href="/equipo">Volver al equipo</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Panel>
      <PanelHeader titulo="Datos del setter" />

      <div className="space-y-3 px-3 py-3">
        <Field label="Nombre">
          <Input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Abril"
            autoFocus
          />
        </Field>

        <Field label="Email" hint="Es con lo que entra a la app.">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="abril@ejemplo.com"
          />
        </Field>

        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[11px] font-medium text-texto-2">Cuentas de Instagram</span>
            <span className="dato text-[11px] text-texto-2">{cupoTotal} mensajes por día</span>
          </div>

          <div className="space-y-2">
            {cuentas.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className="relative min-w-0 flex-1">
                  <span className="dato pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12.5px] text-texto-2">
                    @
                  </span>
                  <Input
                    value={c.usuario}
                    onChange={(e) =>
                      setCuentas((cs) =>
                        cs.map((x, j) => (j === i ? { ...x, usuario: e.target.value } : x)),
                      )
                    }
                    placeholder="cuenta_de_abril"
                    className="pl-5"
                  />
                </div>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={c.cupo}
                  onChange={(e) =>
                    setCuentas((cs) =>
                      cs.map((x, j) => (j === i ? { ...x, cupo: e.target.value } : x)),
                    )
                  }
                  aria-label="Cupo por día"
                  className="w-[72px] shrink-0"
                />
                {cuentas.length > 1 ? (
                  <Button
                    variant="fantasma"
                    size="icono"
                    aria-label="Quitar cuenta"
                    onClick={() => setCuentas((cs) => cs.filter((_, j) => j !== i))}
                  >
                    <X aria-hidden />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>

          {cuentas.length < 5 ? (
            <Button
              variant="fantasma"
              size="sm"
              className="mt-1.5"
              onClick={() =>
                setCuentas((cs) => [...cs, { usuario: '', cupo: String(cupoPorDefecto) }])
              }
            >
              <Plus aria-hidden />
              Agregar otra cuenta
            </Button>
          ) : null}

          <p className="mt-1.5 text-[11px] leading-relaxed text-texto-2/80">
            Pasar de 30 por cuenta en un día es lo que hace que Instagram restrinja la cuenta. Con
            leads fríos, todavía menos.
          </p>
        </div>

        <Field
          label="Leads por día"
          hint="Cuántos se le entregan por jornada. Por defecto, el cupo total de sus cuentas."
        >
          <Input
            type="number"
            min={1}
            max={500}
            value={tanda}
            onChange={(e) => setTandaManual(e.target.value)}
            className="w-[110px]"
          />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-borde px-3 py-2">
        <Button asChild variant="fantasma">
          <Link href="/equipo">Cancelar</Link>
        </Button>
        <Button variant="primaria" onClick={guardar} disabled={pendiente}>
          {pendiente ? 'Creando…' : 'Crear y generar acceso'}
        </Button>
      </div>
    </Panel>
  )
}

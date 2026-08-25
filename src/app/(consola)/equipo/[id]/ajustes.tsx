'use client'

import { Plus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { guardarSetter } from '@/server/actions/equipo'

interface CuentaEditable {
  id: string | null
  usuario: string
  cupo: number
  activa: boolean
}

/**
 * Los cambios del día a día: sumar una cuenta, bajarle el cupo a la que se puso
 * lenta, ajustar cuántos leads recibe, prender el recordatorio automático.
 *
 * Está plegado por defecto. Se abre cuando hace falta y el resto del tiempo no
 * ocupa lugar.
 */
export function Ajustes({
  setterId,
  nombre: nombreInicial,
  tandaDiaria,
  recordatorioAutomatico,
  horaRecordatorio,
  cuentas: cuentasIniciales,
}: {
  setterId: string
  nombre: string
  tandaDiaria: number
  recordatorioAutomatico: boolean
  horaRecordatorio: string
  cuentas: CuentaEditable[]
}) {
  const router = useRouter()
  const [abierto, setAbierto] = React.useState(false)
  const [pendiente, iniciar] = React.useTransition()

  const [nombre, setNombre] = React.useState(nombreInicial)
  const [tanda, setTanda] = React.useState(String(tandaDiaria))
  const [automatico, setAutomatico] = React.useState(recordatorioAutomatico)
  const [hora, setHora] = React.useState(horaRecordatorio)
  const [cuentas, setCuentas] = React.useState<CuentaEditable[]>(cuentasIniciales)

  function guardar(): void {
    iniciar(async () => {
      const r = await guardarSetter({
        setterId,
        nombre,
        tanda: Number(tanda),
        recordatorioAutomatico: automatico,
        horaRecordatorio: hora,
        cuentas: cuentas
          .filter((c) => c.usuario.trim().length > 0)
          .map((c) => ({ id: c.id, usuario: c.usuario, cupo: c.cupo, activa: c.activa })),
      })
      if (r.ok) {
        toast.success('Guardado')
        setAbierto(false)
        router.refresh()
      } else toast.error(r.error ?? 'No se pudo guardar.')
    })
  }

  if (!abierto) {
    return (
      <Panel>
        <PanelHeader
          titulo="Ajustes"
          descripcion={`${tandaDiaria} leads por día · recordatorio automático ${
            recordatorioAutomatico ? `a las ${horaRecordatorio}` : 'apagado'
          }`}
          acciones={
            <Button variant="secundaria" size="sm" onClick={() => setAbierto(true)}>
              Editar
            </Button>
          }
        />
      </Panel>
    )
  }

  return (
    <Panel>
      <PanelHeader titulo="Ajustes" />

      <div className="space-y-4 px-4 py-4">
        <div className="flex flex-wrap gap-3">
          <Field label="Nombre" className="min-w-[180px] flex-1">
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </Field>
          <Field label="Leads por día" className="w-[120px]">
            <Input
              type="number"
              min={1}
              max={500}
              value={tanda}
              onChange={(e) => setTanda(e.target.value)}
            />
          </Field>
        </div>

        <div>
          <span className="mb-1.5 block text-[12px] font-medium text-texto">
            Cuentas de Instagram
          </span>
          <div className="space-y-2">
            {cuentas.map((c, i) => (
              <div key={c.id ?? `nueva-${i}`} className="flex items-center gap-1.5">
                <div className="relative min-w-0 flex-1">
                  <span className="dato pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13.5px] text-texto-2">
                    @
                  </span>
                  <Input
                    value={c.usuario}
                    onChange={(e) =>
                      setCuentas((cs) =>
                        cs.map((x, j) => (j === i ? { ...x, usuario: e.target.value } : x)),
                      )
                    }
                    className="pl-6"
                  />
                </div>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={c.cupo}
                  onChange={(e) =>
                    setCuentas((cs) =>
                      cs.map((x, j) => (j === i ? { ...x, cupo: Number(e.target.value) } : x)),
                    )
                  }
                  aria-label="Mensajes por día"
                  className="w-[80px] shrink-0"
                />
                <Button
                  variant={c.activa ? 'secundaria' : 'contorno'}
                  size="sm"
                  className="shrink-0"
                  onClick={() =>
                    setCuentas((cs) => cs.map((x, j) => (j === i ? { ...x, activa: !x.activa } : x)))
                  }
                  title={
                    c.activa
                      ? 'Desactivar: deja de usarse, pero su historial queda.'
                      : 'Volver a usarla.'
                  }
                >
                  {c.activa ? 'Activa' : 'Desactivada'}
                </Button>
                {c.id === null ? (
                  <Button
                    variant="fantasma"
                    size="icono"
                    aria-label="Quitar"
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
              className="mt-2"
              onClick={() =>
                setCuentas((cs) => [...cs, { id: null, usuario: '', cupo: 30, activa: true }])
              }
            >
              <Plus aria-hidden />
              Agregar cuenta
            </Button>
          ) : null}

          <p className="mt-2 text-[12px] leading-relaxed text-texto-2">
            Pasar de 30 por cuenta en un día es lo que hace que Instagram la restrinja.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-t border-borde pt-4">
          <Button
            variant={automatico ? 'positiva' : 'secundaria'}
            onClick={() => setAutomatico((v) => !v)}
          >
            Recordatorio automático {automatico ? 'encendido' : 'apagado'}
          </Button>
          {automatico ? (
            <Field label="A qué hora" className="w-[120px]">
              <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </Field>
          ) : null}
          <p className="min-w-[220px] flex-1 text-[12px] leading-relaxed text-texto-2">
            Con esto encendido, si le quedan seguimientos pendientes le llega el aviso solo a esa
            hora y dejás de tener que acordarte vos.
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-borde px-4 py-3">
        <Button variant="fantasma" onClick={() => setAbierto(false)} disabled={pendiente}>
          Cancelar
        </Button>
        <Button variant="primaria" onClick={guardar} disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </Panel>
  )
}

'use client'

import { Share2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Panel, PanelHeader } from '@/components/ui/panel'
import type { RepartoPropuesto } from '@/server/setters/reparto'
import { repartirLeads } from '@/server/actions/equipo'

/**
 * Repartir el pozo entre los setters.
 *
 * Muestra el plan antes de apretar, con el motivo de cada número. Un "Bruno 0"
 * sin explicación se lee como un error del sistema; "Bruno 0 porque sus cuentas
 * llegaron al límite de hoy" se lee como lo que es.
 */
export function Reparto({ plan }: { plan: RepartoPropuesto }) {
  const router = useRouter()
  const [pendiente, iniciar] = React.useTransition()

  const hayAlgoQueHacer = plan.total > 0

  // Un cero se explica. El caso que más pasa es el primer día del equipo: los
  // setters existen, el pozo está lleno, y nadie tiene todavía la cuenta de
  // Instagram con la que va a escribir.
  const sinCuenta = plan.tajadas.filter((t) => t.motivo.includes('cuenta de Instagram')).length

  return (
    <Panel>
      <PanelHeader
        titulo="Repartir leads"
        descripcion={
          plan.pozo === 0
            ? 'No hay leads sin asignar. Importá una lista para que haya con qué trabajar.'
            : `${plan.pozo} leads en el pozo. Nadie recibe más de lo que sus cuentas pueden mandar hoy.`
        }
        acciones={
          <Button
            variant="primaria"
            disabled={pendiente || !hayAlgoQueHacer}
            onClick={() =>
              iniciar(async () => {
                const r = await repartirLeads()
                if (r.ok) {
                  toast.success(
                    `${r.entregados} leads repartidos · ${r.porSetter
                      ?.map((s) => `${s.nombre} ${s.cantidad}`)
                      .join(' · ')}`,
                    { duration: 6000 },
                  )
                  router.refresh()
                } else {
                  toast.error(r.error ?? 'No se pudo repartir.')
                }
              })
            }
          >
            <Share2 aria-hidden />
            {pendiente ? 'Repartiendo…' : `Repartir ${plan.total}`}
          </Button>
        }
      />

      {plan.pozo > 0 ? (
        <div className="divide-y divide-borde">
          {plan.tajadas.map((t) => (
            <div key={t.setterId} className="flex flex-wrap items-center gap-x-4 px-4 py-2.5">
              <span className="dato w-[52px] shrink-0 text-[18px] font-semibold text-texto">
                {t.cantidad}
              </span>
              <span className="w-[140px] shrink-0 truncate text-[13.5px] text-texto">
                {t.nombre}
              </span>
              <span className="min-w-0 flex-1 text-[12.5px] text-texto-2">{t.motivo}</span>
            </div>
          ))}
        </div>
      ) : null}

      {plan.pozo > 0 && plan.total === 0 ? (
        <p className="border-t border-borde px-4 py-2.5 text-[12.5px] text-ambar">
          {sinCuenta === plan.tajadas.length
            ? 'Nadie tiene cuenta de Instagram cargada, así que nadie puede mandar nada todavía. '
            : sinCuenta > 0
              ? `${sinCuenta} de ${plan.tajadas.length} no tienen cuenta de Instagram cargada. `
              : 'Hoy nadie tiene cupo libre: ya llegaron a su tanda o al límite de sus cuentas. '}
          {sinCuenta > 0 ? (
            <Link href="/equipo/instagram" className="text-acento hover:underline">
              Cargalas acá
            </Link>
          ) : null}
        </p>
      ) : null}

      {plan.pozo > 0 && plan.sobran > 0 ? (
        <p className="border-t border-borde px-4 py-2.5 text-[12.5px] text-texto-2">
          Quedan <span className="dato text-texto">{plan.sobran}</span> en el pozo para mañana. No
          se entregan hoy porque el equipo no puede mandarlos sin pasarse del límite de sus
          cuentas.
        </p>
      ) : plan.faltan > 0 ? (
        <p className="border-t border-borde px-4 py-2.5 text-[12.5px] text-ambar">
          Al equipo le sobra capacidad para {plan.faltan} leads más. Importá otra lista.
        </p>
      ) : null}
    </Panel>
  )
}

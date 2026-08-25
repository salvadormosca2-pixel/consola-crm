'use client'

import { Check, FileSpreadsheet, Undo2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Chip, Panel, PanelHeader } from '@/components/ui/panel'
import { formatLargo, haceCuanto } from '@/lib/tz'
import { cn } from '@/lib/utils'
import type { FilaParaRevisar, LoteResumen } from '@/server/imports'
import { deshacerImportacion, resolverRevision } from '@/server/actions/import'

/* ── Pestaña Revisar ────────────────────────────────────────────────────── */

export function Revisar({ filas }: { filas: FilaParaRevisar[] }) {
  const [pendiente, iniciar] = React.useTransition()
  const [resueltas, setResueltas] = React.useState<Set<string>>(new Set())

  const visibles = filas.filter((f) => !resueltas.has(f.id))

  if (visibles.length === 0) {
    return (
      <Panel className="px-6 py-14 text-center">
        <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-[5px] border border-verde/35 bg-verde-tenue">
          <Check className="h-4 w-4 text-verde" aria-hidden />
        </div>
        <h2 className="text-[15px]">No hay nada para revisar</h2>
        <p className="mt-1.5 text-[12.5px] text-texto-2">
          Todas las filas de tus importaciones entraron sin problemas.
        </p>
      </Panel>
    )
  }

  function resolver(f: FilaParaRevisar) {
    // Optimista: si falla, la fila vuelve a aparecer y se avisa.
    setResueltas((s) => new Set(s).add(f.id))
    iniciar(async () => {
      const r = await resolverRevision(f.id)
      if (!r.ok) {
        setResueltas((s) => {
          const n = new Set(s)
          n.delete(f.id)
          return n
        })
        toast.error(r.error ?? 'No se pudo marcar como resuelta.')
      }
    })
  }

  return (
    <Panel>
      <PanelHeader
        titulo={`${visibles.length} filas para revisar`}
        descripcion="Ninguna se perdió: están todas acá con el motivo."
      />
      <div className="divide-y divide-borde/60">
        {visibles.map((f) => (
          <div key={f.id} className="flex items-start gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip tono={f.action === 'error' ? 'negativo' : 'activo'}>
                  {f.action === 'error' ? 'No se importó' : 'Importado con avisos'}
                </Chip>
                <span className="dato text-[11px] text-texto-2">
                  {f.filename} · fila {f.rowNumber}
                </span>
                {f.businessName ? (
                  <span className="truncate text-[12.5px] font-medium">{f.businessName}</span>
                ) : null}
              </div>

              <p className="mt-1 text-[12px] text-ambar">{f.reason}</p>

              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                {Object.entries(f.raw)
                  .slice(0, 6)
                  .map(([k, v]) => (
                    <span key={k} className="text-[11px] text-texto-2">
                      <span className="text-texto-2/60">{k}:</span>{' '}
                      <span className="dato text-texto-2">{v}</span>
                    </span>
                  ))}
              </div>
            </div>

            <Button
              variant="fantasma"
              size="sm"
              disabled={pendiente}
              onClick={() => resolver(f)}
              title="Sacarla de la lista"
            >
              <Check aria-hidden />
              Resuelta
            </Button>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/* ── Pestaña Historial ──────────────────────────────────────────────────── */

export function Historial({ lotes }: { lotes: LoteResumen[] }) {
  const [pendiente, iniciar] = React.useTransition()

  if (lotes.length === 0) {
    return (
      <Panel className="px-6 py-14 text-center">
        <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-[5px] border border-borde bg-elevada">
          <FileSpreadsheet className="h-4 w-4 text-texto-2" aria-hidden />
        </div>
        <h2 className="text-[15px]">Todavía no importaste nada</h2>
        <p className="mt-1.5 text-[12.5px] text-texto-2">
          Cuando subas tu primer archivo, acá vas a ver el detalle de cada carga.
        </p>
      </Panel>
    )
  }

  function deshacer(l: LoteResumen) {
    const texto =
      `¿Deshacer la importación de ${l.filename}?\n\n` +
      `Se van a borrar ${l.imported} contactos` +
      (l.updatedRows > 0 ? ` y a revertir ${l.updatedRows} actualizaciones` : '') +
      '. No se puede rehacer.'
    if (!window.confirm(texto)) return

    iniciar(async () => {
      const r = await deshacerImportacion(l.id)
      if (r.ok) toast.success('Importación deshecha')
      else toast.error(r.error ?? 'No se pudo deshacer.')
    })
  }

  return (
    <Panel>
      <PanelHeader titulo="Importaciones" descripcion="Las últimas cargas, de la más nueva a la más vieja." />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-borde bg-elevada/50 text-left">
              <th className="rotulo px-2.5 py-1.5">Archivo</th>
              <th className="rotulo px-2.5 py-1.5">Cuándo</th>
              <th className="rotulo px-2.5 py-1.5 text-right">Filas</th>
              <th className="rotulo px-2.5 py-1.5 text-right">Nuevos</th>
              <th className="rotulo px-2.5 py-1.5 text-right">Actualizados</th>
              <th className="rotulo px-2.5 py-1.5 text-right">Repetidos</th>
              <th className="rotulo px-2.5 py-1.5 text-right">Revisar</th>
              <th className="rotulo px-2.5 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {lotes.map((l) => (
              <tr
                key={l.id}
                className={cn('border-b border-borde/60 last:border-b-0', l.undoneAt && 'opacity-50')}
              >
                <td className="max-w-[240px] truncate px-2.5 py-1.5" title={l.filename}>
                  {l.filename}
                  {l.undoneAt ? <Chip className="ml-1.5">deshecha</Chip> : null}
                </td>
                <td className="px-2.5 py-1.5 text-texto-2" title={formatLargo(l.createdAt)}>
                  {haceCuanto(l.createdAt)}
                </td>
                <td className="dato px-2.5 py-1.5 text-right text-texto-2">{l.rowCount}</td>
                <td className="dato px-2.5 py-1.5 text-right text-verde">{l.imported}</td>
                <td className="dato px-2.5 py-1.5 text-right">{l.updatedRows}</td>
                <td className="dato px-2.5 py-1.5 text-right text-texto-2">{l.duplicates}</td>
                <td className="dato px-2.5 py-1.5 text-right">
                  {l.needsReview + l.errors > 0 ? (
                    <span className="text-ambar">{l.needsReview + l.errors}</span>
                  ) : (
                    <span className="text-texto-2">—</span>
                  )}
                </td>
                <td className="px-2.5 py-1.5 text-right">
                  {l.undoneAt ? null : l.sePuedeDeshacer ? (
                    <Button
                      variant="fantasma"
                      size="sm"
                      disabled={pendiente}
                      onClick={() => deshacer(l)}
                      className="hover:text-rojo"
                    >
                      <Undo2 aria-hidden />
                      Deshacer
                    </Button>
                  ) : (
                    <span
                      className="text-[11px] text-texto-2"
                      title={`Ya se le mandaron mensajes a ${l.conMensajes} de estos contactos, así que borrarlos perdería el registro de que les escribiste.`}
                    >
                      ya se usó
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

'use client'

import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload, X } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { CAMPOS, CAMPO_META, mapeoCompleto, type Campo, type Mapeo } from '@/lib/import/columns'
import type { FilaPreparada } from '@/lib/import/rows'
import { cn } from '@/lib/utils'
import {
  abrirImportacion,
  cerrarImportacion,
  importarLote,
  type ResumenLote,
} from '@/server/actions/import'

/** Filas por lote. Suficientemente grande para ir rápido, chico para dar progreso. */
const TAMANO_LOTE = 200

type Etapa = 'vacio' | 'leyendo' | 'mapeando' | 'importando' | 'listo'

interface Resumen extends ResumenLote {
  duplicadasEnArchivo: number
  porCuenta: Array<{ code: string; label: string; channel: string; asignados: number }>
  batchId: string
  filename: string
}

export function Importador({ mapeoPrevio }: { mapeoPrevio: Mapeo | null }) {
  const [etapa, setEtapa] = React.useState<Etapa>('vacio')
  const [archivo, setArchivo] = React.useState<{ nombre: string } | null>(null)
  const [encabezados, setEncabezados] = React.useState<string[]>([])
  const [vistaPrevia, setVistaPrevia] = React.useState<string[][]>([])
  const [totalFilas, setTotalFilas] = React.useState(0)
  const [mapeo, setMapeo] = React.useState<Mapeo>({})
  const [completarVacios, setCompletarVacios] = React.useState(true)
  const [progreso, setProgreso] = React.useState({ etapa: '', hechas: 0, total: 0 })
  const [resumen, setResumen] = React.useState<Resumen | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [arrastrando, setArrastrando] = React.useState(false)

  const workerRef = React.useRef<Worker | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    return () => workerRef.current?.terminate()
  }, [])

  function reiniciar() {
    workerRef.current?.terminate()
    workerRef.current = null
    setEtapa('vacio')
    setArchivo(null)
    setEncabezados([])
    setVistaPrevia([])
    setTotalFilas(0)
    setMapeo({})
    setResumen(null)
    setError(null)
    setProgreso({ etapa: '', hechas: 0, total: 0 })
    if (inputRef.current) inputRef.current.value = ''
  }

  function crearWorker(): Worker {
    workerRef.current?.terminate()
    const w = new Worker(new URL('@/workers/parse-sheet.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = w
    return w
  }

  async function tomarArchivo(file: File) {
    setError(null)
    setEtapa('leyendo')
    setArchivo({ nombre: file.name })

    const w = crearWorker()
    w.addEventListener('message', (e) => {
      const msg = e.data
      if (msg.tipo === 'progreso') setProgreso(msg)
      else if (msg.tipo === 'leido') {
        setEncabezados(msg.encabezados)
        setVistaPrevia(msg.vistaPrevia)
        setTotalFilas(msg.totalFilas)
        // El mapeo guardado de la importación anterior gana sobre el sugerido,
        // pero solo si las columnas coinciden con las de este archivo.
        const previo = mapeoPrevio && sirveElMapeoPrevio(mapeoPrevio, msg.encabezados.length)
        setMapeo(previo ? mapeoPrevio : msg.mapeoSugerido)
        setEtapa('mapeando')
      } else if (msg.tipo === 'error') {
        setError(msg.mensaje)
        setEtapa('vacio')
      }
    })

    const buffer = await file.arrayBuffer()
    w.postMessage({ tipo: 'leer', archivo: buffer, nombre: file.name }, [buffer])
  }

  async function importar() {
    const check = mapeoCompleto(mapeo)
    if (!check.ok) {
      setError(`Falta indicar: ${check.falta.join(', ')}.`)
      return
    }
    if (!archivo) return

    setError(null)
    setEtapa('importando')

    const w = crearWorker()
    const filas = await new Promise<{ filas: FilaPreparada[]; duplicadasEnArchivo: number }>(
      (resolve, reject) => {
        w.addEventListener('message', (e) => {
          const msg = e.data
          if (msg.tipo === 'progreso') setProgreso(msg)
          else if (msg.tipo === 'preparado') resolve(msg)
          else if (msg.tipo === 'error') reject(new Error(msg.mensaje))
        })
        w.postMessage({ tipo: 'preparar', mapeo })
      },
    ).catch((e: Error) => {
      setError(e.message)
      setEtapa('mapeando')
      return null
    })

    if (!filas) return

    const apertura = await abrirImportacion(
      archivo.nombre,
      totalFilas,
      mapeo as Record<string, number>,
    )
    if (!apertura.ok) {
      setError(apertura.error)
      setEtapa('mapeando')
      return
    }

    const total: ResumenLote = {
      insertados: 0,
      actualizados: 0,
      duplicados: 0,
      paraRevisar: 0,
      errores: 0,
    }
    const porCuenta = new Map<string, { code: string; label: string; channel: string; asignados: number }>()

    for (let i = 0; i < filas.filas.length; i += TAMANO_LOTE) {
      const lote = filas.filas.slice(i, i + TAMANO_LOTE)
      setProgreso({
        etapa: 'Guardando',
        hechas: Math.min(i + TAMANO_LOTE, filas.filas.length),
        total: filas.filas.length,
      })

      const r = await importarLote(apertura.batchId, lote, completarVacios)
      total.insertados += r.resumen.insertados
      total.actualizados += r.resumen.actualizados
      total.duplicados += r.resumen.duplicados
      total.paraRevisar += r.resumen.paraRevisar
      total.errores += r.resumen.errores

      for (const c of r.porCuenta) {
        const previo = porCuenta.get(c.code)
        porCuenta.set(c.code, previo ? { ...c, asignados: previo.asignados + c.asignados } : c)
      }

      if (!r.ok) {
        setError(r.error ?? 'Falló un lote.')
        break
      }
    }

    await cerrarImportacion(apertura.batchId)

    setResumen({
      ...total,
      duplicadasEnArchivo: filas.duplicadasEnArchivo,
      porCuenta: [...porCuenta.values()].sort((a, b) => b.asignados - a.asignados),
      batchId: apertura.batchId,
      filename: archivo.nombre,
    })
    setEtapa('listo')
    toast.success(`${total.insertados} contactos nuevos`)
  }

  /* ── Pantallas ───────────────────────────────────────────────────────── */

  if (etapa === 'listo' && resumen) {
    return <ResumenImportacion resumen={resumen} onOtra={reiniciar} error={error} />
  }

  if (etapa === 'vacio' || etapa === 'leyendo') {
    return (
      <Panel>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setArrastrando(true)
          }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => {
            e.preventDefault()
            setArrastrando(false)
            const f = e.dataTransfer.files[0]
            if (f) void tomarArchivo(f)
          }}
          className={cn(
            'flex flex-col items-center justify-center px-6 py-16 transition-colors duration-150',
            arrastrando && 'bg-ambar/5',
          )}
        >
          <div
            className={cn(
              'mb-3 flex h-10 w-10 items-center justify-center rounded-[5px] border',
              arrastrando ? 'border-ambar bg-ambar/12' : 'border-borde bg-elevada',
            )}
          >
            {etapa === 'leyendo' ? (
              <FileSpreadsheet className="h-4 w-4 text-ambar" />
            ) : (
              <Upload className={cn('h-4 w-4', arrastrando ? 'text-ambar' : 'text-texto-2')} />
            )}
          </div>

          {etapa === 'leyendo' ? (
            <>
              <h2 className="text-[15px]">Leyendo {archivo?.nombre}</h2>
              <p className="mt-1 text-[12.5px] text-texto-2">{progreso.etapa}…</p>
            </>
          ) : (
            <>
              <h2 className="text-[15px]">Arrastrá tu lista acá</h2>
              <p className="mt-1.5 max-w-md text-center text-[12.5px] leading-relaxed text-texto-2">
                Excel o CSV, con una fila por negocio. Después vas a poder revisar qué columna es
                cada cosa antes de que se importe nada.
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                id="archivo"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void tomarArchivo(f)
                }}
              />
              <Button
                variant="primaria"
                className="mt-4"
                onClick={() => inputRef.current?.click()}
              >
                Elegir archivo
              </Button>
            </>
          )}

          {error ? (
            <p role="alert" className="mt-4 rounded-[4px] border border-rojo/35 bg-rojo/10 px-2 py-1.5 text-[11.5px] text-rojo">
              {error}
            </p>
          ) : null}
        </div>
      </Panel>
    )
  }

  if (etapa === 'importando') {
    const pct = progreso.total > 0 ? Math.round((progreso.hechas / progreso.total) * 100) : 0
    return (
      <Panel className="px-4 py-10">
        <div className="mx-auto max-w-md">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[13px]">{progreso.etapa || 'Preparando'}…</span>
            <span className="dato text-[12px] text-texto-2">
              {progreso.hechas}/{progreso.total}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-[2px] bg-borde/50">
            <div
              className="h-full bg-ambar transition-[width] duration-200 ease-[cubic-bezier(0.2,0,0,1)]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-3 text-center text-[11.5px] text-texto-2">
            No cierres esta pestaña hasta que termine.
          </p>
          {error ? (
            <p role="alert" className="mt-3 rounded-[4px] border border-rojo/35 bg-rojo/10 px-2 py-1.5 text-[11.5px] text-rojo">
              {error}
            </p>
          ) : null}
        </div>
      </Panel>
    )
  }

  // etapa === 'mapeando'
  const check = mapeoCompleto(mapeo)
  const usadas = new Set(Object.values(mapeo))

  return (
    <div className="space-y-3">
      <Panel>
        <PanelHeader
          titulo={`${archivo?.nombre} · ${totalFilas.toLocaleString('es-AR')} filas`}
          descripcion="Revisá que cada columna esté bien identificada antes de importar."
          acciones={
            <Button variant="fantasma" size="sm" onClick={reiniciar}>
              <X aria-hidden />
              Cambiar archivo
            </Button>
          }
        />

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-borde bg-elevada/50">
                {encabezados.map((h, i) => {
                  const campo = (Object.keys(mapeo) as Campo[]).find((c) => mapeo[c] === i)
                  return (
                    <th key={i} className="min-w-[140px] px-2 py-1.5 text-left align-top">
                      <div className="mb-1 truncate text-[11px] font-normal text-texto-2" title={h}>
                        {h || `Columna ${i + 1}`}
                      </div>
                      <select
                        aria-label={`Qué es la columna ${h || i + 1}`}
                        value={campo ?? ''}
                        onChange={(e) => {
                          const nuevo = { ...mapeo }
                          if (campo) delete nuevo[campo]
                          const elegido = e.target.value as Campo | ''
                          if (elegido) {
                            for (const c of CAMPOS) if (nuevo[c] === i) delete nuevo[c]
                            nuevo[elegido] = i
                          }
                          setMapeo(nuevo)
                        }}
                        className={cn(
                          'h-6 w-full rounded-[4px] border bg-fondo px-1 text-[11px] focus:border-ambar focus:outline-none',
                          campo ? 'border-ambar/40 text-ambar' : 'border-borde text-texto-2',
                        )}
                      >
                        <option value="">— no importar —</option>
                        {CAMPOS.map((c) => (
                          <option key={c} value={c} disabled={usadas.has(mapeo[c]!) && mapeo[c] !== i}>
                            {CAMPO_META[c].label}
                          </option>
                        ))}
                      </select>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {vistaPrevia.map((fila, i) => (
                <tr key={i} className="border-b border-borde/60 last:border-b-0">
                  {encabezados.map((_, c) => (
                    <td key={c} className="max-w-[220px] truncate px-2 py-1 text-texto-2" title={fila[c]}>
                      {fila[c] || <span className="text-texto-2/40">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-borde px-3 py-2 text-[11px] text-texto-2">
          Vista previa de las primeras {vistaPrevia.length} filas.
        </div>
      </Panel>

      <Panel className="p-3">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={completarVacios}
            onChange={(e) => setCompletarVacios(e.target.checked)}
            className="mt-0.5 h-3 w-3 accent-[#e8a33d]"
          />
          <span className="text-[12.5px]">
            Completar los campos vacíos de los contactos que ya existan
            <span className="mt-0.5 block text-[11px] text-texto-2">
              Nunca se pisa un dato que ya tengas cargado. Si lo destildás, los repetidos se cuentan
              pero no se tocan.
            </span>
          </span>
        </label>

        {!check.ok ? (
          <p className="mt-3 rounded-[4px] border border-ambar/35 bg-ambar/10 px-2 py-1.5 text-[11.5px] text-ambar">
            Falta indicar: {check.falta.join(', ')}.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 rounded-[4px] border border-rojo/35 bg-rojo/10 px-2 py-1.5 text-[11.5px] text-rojo">
            {error}
          </p>
        ) : null}

        <div className="mt-3 flex justify-end gap-1.5 border-t border-borde pt-3">
          <Button variant="fantasma" onClick={reiniciar}>
            Cancelar
          </Button>
          <Button variant="primaria" disabled={!check.ok} onClick={() => void importar()}>
            Importar {totalFilas.toLocaleString('es-AR')} filas
          </Button>
        </div>
      </Panel>
    </div>
  )
}

function sirveElMapeoPrevio(mapeo: Mapeo, columnas: number): boolean {
  const indices = Object.values(mapeo)
  return indices.length > 0 && indices.every((i) => i < columnas)
}

function ResumenImportacion({
  resumen,
  onOtra,
  error,
}: {
  resumen: Resumen
  onOtra: () => void
  error: string | null
}) {
  return (
    <div className="space-y-3">
      <Panel>
        <PanelHeader
          titulo={`Importación de ${resumen.filename}`}
          descripcion={
            error
              ? 'La importación quedó incompleta.'
              : 'Listo. Los contactos ya están en tu base.'
          }
          acciones={
            <Button variant="secundaria" size="sm" onClick={onOtra}>
              Importar otro
            </Button>
          }
        />

        <div className="grid grid-cols-2 gap-px bg-borde sm:grid-cols-5">
          <Cifra rotulo="Nuevos" valor={resumen.insertados} tono="verde" />
          <Cifra rotulo="Actualizados" valor={resumen.actualizados} />
          <Cifra rotulo="Ya existían" valor={resumen.duplicados} />
          <Cifra rotulo="Para revisar" valor={resumen.paraRevisar} tono={resumen.paraRevisar > 0 ? 'ambar' : undefined} />
          <Cifra rotulo="No se pudieron" valor={resumen.errores} tono={resumen.errores > 0 ? 'rojo' : undefined} />
        </div>

        {resumen.duplicadasEnArchivo > 0 ? (
          <p className="border-t border-borde px-3 py-2 text-[11.5px] text-texto-2">
            Además, {resumen.duplicadasEnArchivo} filas del archivo eran repetidas entre sí y se
            fusionaron en una sola antes de importar.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="border-t border-borde px-3 py-2 text-[11.5px] text-rojo">
            {error}
          </p>
        ) : null}
      </Panel>

      {resumen.porCuenta.length > 0 ? (
        <Panel>
          <PanelHeader titulo="Cómo quedaron repartidos" />
          <div className="divide-y divide-borde/60">
            {resumen.porCuenta.map((c) => (
              <div key={c.code} className="flex items-center justify-between px-3 py-1.5">
                <span className="text-[12.5px]">
                  <span className="dato text-texto-2">{c.code}</span>{' '}
                  <span className="text-texto">{c.label}</span>
                </span>
                <span className="dato text-[12.5px]">{c.asignados}</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {resumen.paraRevisar > 0 || resumen.errores > 0 ? (
          <span className="flex items-center gap-1.5 text-[12px] text-ambar">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            Hay {resumen.paraRevisar + resumen.errores} filas que necesitan que las mires.
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[12px] text-verde">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            No quedó nada pendiente de revisar.
          </span>
        )}
      </div>
    </div>
  )
}

function Cifra({
  rotulo,
  valor,
  tono,
}: {
  rotulo: string
  valor: number
  tono?: 'verde' | 'ambar' | 'rojo'
}) {
  return (
    <div className="bg-superficie px-3 py-2">
      <div className="rotulo truncate">{rotulo}</div>
      <div
        className={cn(
          'dato mt-1 text-[20px] font-medium leading-none',
          tono === 'verde' && 'text-verde',
          tono === 'ambar' && 'text-ambar',
          tono === 'rojo' && 'text-rojo',
          !tono && 'text-texto',
        )}
      >
        {valor.toLocaleString('es-AR')}
      </div>
    </div>
  )
}

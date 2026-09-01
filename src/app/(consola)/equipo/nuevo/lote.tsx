'use client'

import { ClipboardCopy, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'
import { toast } from 'sonner'

import { TarjetaDeAcceso } from '@/components/tarjeta-acceso'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { copiarAlPortapapeles } from '@/lib/copiar'
import {
  filasValidas,
  MAXIMO_POR_LOTE,
  normalizarInstagram,
  parsearLote,
  type FilaDeLote,
} from '@/lib/equipo-lote'
import { crearSettersEnLote, type TarjetaDeAlta } from '@/server/actions/equipo'

/**
 * Alta de a muchos: pegar la lista, revisar los nombres, crear.
 *
 * Los tres pasos están separados a propósito. El del medio es el que importa:
 * lo que se pega son mails, y el nombre que sale de un mail es una propuesta
 * —`Joacavarela`, `Abriilsegura`—, no un dato. Se muestra editable antes de
 * crear nada porque después la corrección hay que ir a buscarla ficha por
 * ficha, y nadie la hace.
 */

const EJEMPLO = [
  'benja@ejemplo.com',
  'pilar@ejemplo.com, Pilar Girardi',
  'santi@ejemplo.com, Santi Vergara, @cuenta_de_santi',
].join('\n')

type Paso =
  | { fase: 'pegar' }
  | { fase: 'revisar'; filas: FilaDeLote[] }
  | { fase: 'listo'; creados: TarjetaDeAlta[]; omitidos: Array<{ email: string; motivo: string }> }

export function Lote({ cupoPorDefecto }: { cupoPorDefecto: number }) {
  const [texto, setTexto] = React.useState('')
  const [cupo, setCupo] = React.useState(String(cupoPorDefecto))
  const [tandaManual, setTandaManual] = React.useState<string | null>(null)
  const [paso, setPaso] = React.useState<Paso>({ fase: 'pegar' })
  const [pendiente, iniciar] = React.useTransition()

  // Entregarle más leads por día que mensajes puede mandar es entregarle una
  // forma de quemar la cuenta, así que la tanda sigue al cupo salvo que se
  // escriba otra cosa a mano.
  const tanda = tandaManual ?? cupo

  /*
   * Las contraseñas están en memoria y en ningún otro lado: recargar la
   * pestaña las borra y hay que restablecer las dieciséis a mano. Esto no
   * frena una navegación dentro de la app (el navegador no la considera una
   * salida), solo el cierre y la recarga, que es justo donde se pierden.
   */
  const hayTarjetas = paso.fase === 'listo' && paso.creados.length > 0
  React.useEffect(() => {
    if (!hayTarjetas) return
    const avisar = (e: BeforeUnloadEvent): void => e.preventDefault()
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [hayTarjetas])

  function revisar(): void {
    const filas = parsearLote(texto)
    if (filas.length === 0) {
      toast.error('No hay nada en la lista.')
      return
    }
    if (filasValidas(filas).length > MAXIMO_POR_LOTE) {
      toast.error(`Son más de ${MAXIMO_POR_LOTE}. Partilo en dos tandas.`)
      return
    }
    setPaso({ fase: 'revisar', filas })
  }

  /** Cambiar el nombre o el Instagram de una fila, sin tocar el resto. */
  function editar(filas: FilaDeLote[], linea: number, cambio: Partial<FilaDeLote>): void {
    setPaso({
      fase: 'revisar',
      filas: filas.map((f) => (f.linea === linea ? { ...f, ...cambio } : f)),
    })
  }

  function crear(filas: FilaDeLote[]): void {
    const listos = filasValidas(filas)
    if (listos.some((f) => f.nombre.trim().length < 2)) {
      toast.error('Hay alguien sin nombre. Completalo antes de crear.')
      return
    }

    iniciar(async () => {
      const r = await crearSettersEnLote({
        tanda: Number(tanda),
        cupo: Number(cupo),
        setters: listos.map((f) => ({
          nombre: f.nombre.trim(),
          email: f.email,
          instagram: normalizarInstagram(f.instagram),
        })),
      })

      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setPaso({ fase: 'listo', creados: r.creados, omitidos: r.omitidos })
    })
  }

  if (paso.fase === 'listo') return <Resultado {...paso} />

  if (paso.fase === 'revisar') {
    const { filas } = paso
    const listos = filasValidas(filas)
    const conProblema = filas.length - listos.length

    return (
      <div className="space-y-3">
        <Panel>
          <PanelHeader
            titulo={`${listos.length} para dar de alta`}
            descripcion={
              conProblema > 0
                ? `${conProblema} ${conProblema === 1 ? 'línea' : 'líneas'} quedan afuera: están abajo, con el motivo.`
                : 'Corregí los nombres que hagan falta: son los que van a ver ellos en la tarjeta.'
            }
          />

          <div className="divide-y divide-borde">
            {filas.map((fila) =>
              fila.error ? (
                <div key={fila.linea} className="px-3 py-2">
                  <div className="dato text-[12.5px] text-texto-2 line-through">
                    {fila.original}
                  </div>
                  <div className="mt-0.5 text-[12px] text-rojo">
                    Línea {fila.linea} · {fila.error}
                  </div>
                </div>
              ) : (
                <div key={fila.linea} className="space-y-1.5 px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={fila.nombre}
                      aria-label={`Nombre de ${fila.email}`}
                      onChange={(e) => editar(filas, fila.linea, { nombre: e.target.value })}
                      className="min-w-0 flex-1"
                    />
                    <div className="relative min-w-0 flex-1">
                      <span className="dato pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12.5px] text-texto-2">
                        @
                      </span>
                      <Input
                        value={fila.instagram}
                        aria-label={`Instagram de ${fila.email} (opcional)`}
                        placeholder="instagram, opcional"
                        spellCheck={false}
                        onChange={(e) => editar(filas, fila.linea, { instagram: e.target.value })}
                        className="pl-5"
                      />
                    </div>
                  </div>
                  <div className="dato break-all text-[12px] text-texto-2">{fila.email}</div>
                </div>
              ),
            )}
          </div>

          <div className="space-y-2 border-t border-borde px-3 py-3">
            <div className="flex flex-wrap gap-3">
              <Field
                label="Mensajes por día"
                hint="Por cuenta de Instagram. Más de 30 la hace restringir."
              >
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={cupo}
                  onChange={(e) => setCupo(e.target.value)}
                  className="w-[110px]"
                />
              </Field>

              <Field label="Leads por día" hint="Cuántos se le entregan a cada uno por jornada.">
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

            <p className="text-[12px] leading-relaxed text-texto-2">
              El Instagram es <strong className="font-semibold text-texto">opcional</strong>: el que
              quede vacío entra igual y se le carga después desde{' '}
              <strong className="font-semibold text-texto">Equipo → Cuentas de Instagram</strong>,
              que edita solo eso. Hasta que tenga una, no recibe leads.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-borde px-3 py-2">
            <Button variant="fantasma" onClick={() => setPaso({ fase: 'pegar' })}>
              Volver a la lista
            </Button>
            <Button
              variant="primaria"
              disabled={pendiente || listos.length === 0}
              onClick={() => crear(filas)}
            >
              {pendiente ? 'Creando…' : `Dar de alta ${listos.length}`}
            </Button>
          </div>
        </Panel>
      </div>
    )
  }

  return (
    <Panel>
      <PanelHeader
        titulo="La lista"
        descripcion="Uno por línea. Con el mail alcanza; después de una coma podés agregar el nombre y, si ya la tenés, la cuenta de Instagram con arroba."
      />

      <div className="px-3 py-3">
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={EJEMPLO}
          rows={10}
          autoFocus
          spellCheck={false}
          className="dato text-[12.5px]"
        />
        <p className="mt-1.5 text-[12px] leading-relaxed text-texto-2">
          Hasta {MAXIMO_POR_LOTE} por tanda. En el paso siguiente vas a poder corregir los nombres
          antes de crear nada.
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-borde px-3 py-2">
        <Button asChild variant="fantasma">
          <Link href="/equipo">Cancelar</Link>
        </Button>
        <Button variant="primaria" onClick={revisar} disabled={texto.trim().length === 0}>
          Revisar la lista
        </Button>
      </div>
    </Panel>
  )
}

/**
 * Las tarjetas recién creadas.
 *
 * El botón de arriba copia las de todos de una sola vez: son dieciséis mensajes
 * de WhatsApp, y volver a esta pantalla a buscar la próxima no existe — las
 * contraseñas no se pueden volver a ver.
 */
function Resultado({
  creados,
  omitidos,
}: {
  creados: TarjetaDeAlta[]
  omitidos: Array<{ email: string; motivo: string }>
}) {
  async function copiarTodas(): Promise<void> {
    const todo = creados.map((c) => c.tarjeta).join('\n\n———\n\n')
    if (await copiarAlPortapapeles(todo)) toast.success('Copiadas. Pegalas y repartilas.')
    else toast.error('No se pudo copiar. Copiá una por una, más abajo.')
  }

  return (
    <div className="space-y-3">
      {creados.length > 0 ? (
        <Panel className="border-ambar/40">
          <div className="flex items-start gap-2 px-3 py-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-ambar" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-texto">
                {creados.length} {creados.length === 1 ? 'acceso creado' : 'accesos creados'}
              </p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-texto-2">
                Las contraseñas se ven una sola vez. Copiálas ahora; si cerrás esta pantalla,
                en Equipo podés generar accesos nuevos y copiarlos de ahí.
              </p>
              <Button variant="primaria" size="lg" className="mt-2" onClick={() => void copiarTodas()}>
                <ClipboardCopy aria-hidden />
                Copiar las {creados.length}
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {omitidos.length > 0 ? (
        <Panel>
          <PanelHeader
            titulo={`${omitidos.length} sin crear`}
            descripcion="Estos quedaron afuera. El resto se creó igual."
          />
          <ul className="divide-y divide-borde">
            {omitidos.map((o) => (
              <li key={o.email} className="px-3 py-2">
                <div className="dato text-[12.5px] text-texto">{o.email}</div>
                <div className="mt-0.5 text-[12px] text-texto-2">{o.motivo}</div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {creados.map((c) => (
        <TarjetaDeAcceso
          key={c.setterId}
          {...c}
          titulo={c.reactivado ? `${c.nombre} · volvió al equipo` : c.nombre}
        />
      ))}

      <div className="flex gap-2">
        <Button asChild variant="secundaria" size="lg" className="flex-1">
          <Link href="/equipo">Volver al equipo</Link>
        </Button>
      </div>
    </div>
  )
}

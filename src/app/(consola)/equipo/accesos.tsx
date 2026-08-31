'use client'

import { ClipboardCopy, KeyRound, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { TarjetaDeAcceso } from '@/components/tarjeta-acceso'
import { Button } from '@/components/ui/button'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { copiarAlPortapapeles } from '@/lib/copiar'
import { restablecerPassword, type ResultadoRestablecer } from '@/server/actions/equipo'

/**
 * Los accesos del equipo, para copiar y mandar.
 *
 * La pantalla que faltaba. La tarjeta de acceso se veía una sola vez —al crear
 * al setter— y después no existía forma de volver a ella sin entrar a la ficha
 * de cada uno, de a uno. El que da de alta a ocho personas un lunes y cierra la
 * pestaña se quedaba sin nada que mandarles.
 *
 * Acá el acceso de cualquiera está a un click, y los de todo el equipo a dos.
 *
 * Hay una cosa que este panel **no** puede hacer y conviene decirla sin vueltas:
 * mostrar la contraseña que ya tiene alguien. Están guardadas con hash y no se
 * pueden leer ni desde acá ni desde la base. Generar una nueva es la única
 * respuesta posible, así que el panel se ocupa de que eso no sea una trampa:
 * separa a los que nunca entraron —donde regenerar no le saca nada a nadie— de
 * los que ya están trabajando, que piden confirmación aparte.
 */

export interface SetterParaAcceso {
  setterId: string
  nombre: string
  email: string
  /**
   * Nunca inició sesión. La contraseña que tiene es la temporal del alta y no
   * la usó nunca: generarle otra no le saca nada.
   */
  nuncaEntro: boolean
}

type Tarjeta = Extract<ResultadoRestablecer, { ok: true }>

export function Accesos({
  setters,
  esAdminMadre,
}: {
  setters: SetterParaAcceso[]
  esAdminMadre: boolean
}) {
  const router = useRouter()
  const [tarjetas, setTarjetas] = React.useState<Record<string, Tarjeta>>({})
  const [trabajando, setTrabajando] = React.useState<string | null>(null)
  const [confirmando, setConfirmando] = React.useState<string | null>(null)

  if (setters.length === 0) return null

  if (!esAdminMadre) {
    return (
      <Panel>
        <PanelHeader
          titulo="Accesos"
          descripcion="Los accesos los genera la cuenta principal. Pedíselos a quien la tenga."
        />
      </Panel>
    )
  }

  const pendientes = setters.filter((s) => s.nuncaEntro && !tarjetas[s.setterId])
  const generadas = setters.map((s) => tarjetas[s.setterId]).filter((t): t is Tarjeta => Boolean(t))

  async function generar(setter: SetterParaAcceso): Promise<void> {
    setConfirmando(null)
    setTrabajando(setter.setterId)
    try {
      const r = await restablecerPassword(setter.setterId)
      if (r.ok) {
        setTarjetas((t) => ({ ...t, [setter.setterId]: r }))
        // Que aparezca abajo no alcanza si la lista es larga y el botón que se
        // tocó quedó arriba de todo.
        toast.success(`Acceso de ${setter.nombre} listo, más abajo`)
      } else {
        toast.error(r.error)
      }
    } finally {
      setTrabajando(null)
      router.refresh()
    }
  }

  /**
   * Los de todos los que nunca entraron, de una.
   *
   * Uno por uno y no en paralelo: son pocos y cada uno escribe en la base. Si
   * alguno falla, los demás se generaron igual y se ven abajo — lo peor sería
   * perder los seis que sí salieron por culpa del séptimo.
   */
  async function generarTodos(): Promise<void> {
    setTrabajando('todos')
    let fallaron = 0
    try {
      for (const s of pendientes) {
        const r = await restablecerPassword(s.setterId)
        if (r.ok) setTarjetas((t) => ({ ...t, [s.setterId]: r }))
        else fallaron++
      }
    } finally {
      setTrabajando(null)
      router.refresh()
    }

    if (fallaron === 0) toast.success('Listo. Copiá los accesos y repartilos.')
    else toast.error(`${fallaron} no se pudieron generar. El resto está abajo.`)
  }

  async function copiarTodas(): Promise<void> {
    const todo = generadas.map((t) => t.tarjeta).join('\n\n———\n\n')
    if (await copiarAlPortapapeles(todo)) toast.success('Copiados. Pegalos y repartilos.')
    else toast.error('No se pudo copiar. Copiá uno por uno, más abajo.')
  }

  return (
    <div className="space-y-3">
      <Panel>
        <PanelHeader
          titulo="Accesos"
          descripcion="El link, el usuario y la contraseña de cada uno, listos para pegar por WhatsApp."
          acciones={
            pendientes.length > 0 ? (
              <Button
                variant="primaria"
                disabled={trabajando !== null}
                onClick={() => void generarTodos()}
              >
                <KeyRound aria-hidden />
                {trabajando === 'todos'
                  ? 'Generando…'
                  : `Generar los ${pendientes.length} que faltan`}
              </Button>
            ) : null
          }
        />

        <ul className="divide-y divide-borde/60">
          {setters.map((s) => {
            const tarjeta = tarjetas[s.setterId]
            const ocupado = trabajando !== null

            return (
              <li
                key={s.setterId}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
              >
                <div className="min-w-0">
                  <span className="text-[13px] text-texto">{s.nombre}</span>
                  <span className="dato ml-2 text-[11.5px] text-texto-2">{s.email}</span>
                </div>

                {tarjeta ? (
                  <Button
                    variant="positiva"
                    size="sm"
                    onClick={() => {
                      void copiarAlPortapapeles(tarjeta.tarjeta).then((ok) => {
                        if (ok) toast.success(`Acceso de ${s.nombre} copiado`)
                        else toast.error('No se pudo copiar. Está abajo para copiar a mano.')
                      })
                    }}
                  >
                    <ClipboardCopy aria-hidden />
                    Copiar el suyo
                  </Button>
                ) : confirmando === s.setterId ? (
                  /*
                   * Ya está trabajando con una contraseña que eligió él. Generar
                   * otra lo deja afuera hasta que lea el WhatsApp, así que esto
                   * no puede pasar de un toque distraído.
                   */
                  <div className="flex items-center gap-1.5 rounded-[5px] border border-ambar/35 bg-ambar-tenue px-2 py-1">
                    <span className="text-[11.5px] text-texto-2">
                      {s.nombre} ya entró: la contraseña que usa deja de servir.
                    </span>
                    <Button
                      variant="secundaria"
                      size="sm"
                      disabled={ocupado}
                      onClick={() => void generar(s)}
                    >
                      Generar igual
                    </Button>
                    <Button variant="fantasma" size="sm" onClick={() => setConfirmando(null)}>
                      No
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant={s.nuncaEntro ? 'secundaria' : 'fantasma'}
                    size="sm"
                    disabled={ocupado}
                    title={
                      s.nuncaEntro
                        ? 'Nunca entró: todavía tiene la contraseña del alta y no la usó.'
                        : 'Ya entró y eligió la suya. Generar otra lo deja afuera hasta que la reciba.'
                    }
                    onClick={() => {
                      if (s.nuncaEntro) void generar(s)
                      else setConfirmando(s.setterId)
                    }}
                  >
                    <KeyRound aria-hidden />
                    {trabajando === s.setterId ? 'Generando…' : 'Generar acceso'}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>

        <p className="flex items-start gap-1.5 border-t border-borde px-4 py-2 text-[11.5px] leading-relaxed text-texto-2">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-texto-2" aria-hidden />
          Las contraseñas están guardadas con hash: no se pueden leer, ni desde acá ni desde la
          base. Por eso el botón arma una contraseña nueva en vez de mostrar la que ya tiene.
        </p>
      </Panel>

      {generadas.length > 1 ? (
        <Button variant="primaria" size="lg" className="w-full" onClick={() => void copiarTodas()}>
          <ClipboardCopy aria-hidden />
          Copiar los {generadas.length} juntos
        </Button>
      ) : null}

      {generadas.map((t) => (
        <TarjetaDeAcceso key={t.email} {...t} titulo={t.nombre} />
      ))}
    </div>
  )
}

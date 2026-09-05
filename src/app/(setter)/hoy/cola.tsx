'use client'

import {
  Ban,
  Check,
  CloudOff,
  ExternalLink,
  Repeat,
  Send,
  SkipForward,
  Undo2,
  UserX,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'

import { AbrirInstagram } from '@/components/setter/abrir-instagram'
import { ActivarAvisos, CintaInstalar } from '@/components/setter/pwa'
import { Button } from '@/components/ui/button'
import { Chip, Panel } from '@/components/ui/panel'
import { PASO_META } from '@/lib/mensajes-config'
import { SECCIONES, SECCION_META, ubicacionDePaso, type Seccion } from '@/lib/pistas'
import { copiarAlPortapapeles } from '@/lib/copiar'
import { motivoDelCambio } from '@/lib/setters-cupo'
import * as outbox from '@/lib/outbox'
import { cn } from '@/lib/utils'
import {
  abrirChat,
  confirmarCambioDeCuenta,
  descartarLead,
  deshacerMarca,
  marcarCuentaInexistente,
  marcarEnviado,
  pedirMasLeads,
  saltearLead,
} from '@/server/actions/setter'
import type { ColaDelSetter, ItemDeCola, ResumenDelDia } from '@/server/setters/cola'
import type { PuertaDeEntrada } from '@/server/setters/avisos'

import { Cuentas } from './cuentas'
import {
  AnuncioFijado,
  CartelDeCambio,
  CartelDeMensaje,
  CartelDeRecordatorio,
  CartelDeSeguimientos,
} from './carteles'

/**
 * El día del setter, en dos listas que no se mezclan.
 *
 * Arriba de todo hay un selector con las dos, y cada una tiene su propia cola,
 * su propio cartel de vacío y su propia regla de cupo:
 *
 *   · **Lista para contactar hoy** — el primer mensaje a alguien que nunca te
 *     contestó. Gasta cupo, y cuando la cuenta llega al tope esta lista se
 *     frena.
 *   · **Seguimiento** — conversaciones ya abiertas. No gasta cupo y no se
 *     frena nunca: dejar sin respuesta a alguien que te escribió por el
 *     presupuesto de abrir desconocidos es exactamente al revés.
 *
 * Estaban en una sola cola, y la pantalla llamaba "seguimiento" a todo lo que
 * no fuera la entrada. El setter entraba, leía "hoy te tocan 12 seguimientos",
 * y los primeros que le salían eran aperturas. Ahora la lista se elige y se ve
 * escrita, así que lo que está haciendo no se adivina.
 *
 * Adentro de cualquiera de las dos el trabajo es el mismo: un lead a la vez,
 * mirar el negocio, tocar "Abrir Instagram" (que copia el mensaje y abre el
 * chat), pegar, mandar, y volver a tocar "Enviado". Dos toques y nada que
 * escribir.
 *
 * El botón de marcar no se habilita hasta haber abierto el chat. No es
 * desconfianza: evita el marcado accidental con el pulgar y deja registrada la
 * hora real en que se abrió la conversación.
 */

const CLAVE_SEGUIMIENTOS = 'consola.seguimientos-vistos'

export function Cola({
  cola,
  puerta,
  clavePublica,
}: {
  cola: ColaDelSetter
  puerta: PuertaDeEntrada
  clavePublica: string | null
}) {
  const router = useRouter()
  const [pendiente, iniciar] = React.useTransition()

  /* ── Qué se interpone antes de la cola ──────────────────────────────── */
  const [bloqueanteConfirmado, setBloqueanteConfirmado] = React.useState(false)
  const [importantesVistos, setImportantesVistos] = React.useState(0)
  const [recordatorioVisto, setRecordatorioVisto] = React.useState(false)
  const [seguimientosVistos, setSeguimientosVistos] = React.useState(true)

  React.useEffect(() => {
    if (cola.seguimientos.length === 0) return
    try {
      const hoy = new Date().toDateString()
      setSeguimientosVistos(sessionStorage.getItem(CLAVE_SEGUIMIENTOS) === hoy)
    } catch {
      setSeguimientosVistos(false)
    }
  }, [cola.seguimientos.length])

  /* ── Estado de la cola ──────────────────────────────────────────────── */
  /*
   * En cuál de las dos listas está trabajando. Arranca en seguimiento cuando
   * hay: una conversación abierta que espera respuesta vale más que un
   * desconocido sin tocar, y es el orden que el equipo ya venía usando.
   */
  const [seccion, setSeccion] = React.useState<Seccion>(
    cola.seguimientos.length > 0 ? 'seguimiento' : 'apertura',
  )
  const [hechos, setHechos] = React.useState<Set<string>>(new Set())
  const [abiertos, setAbiertos] = React.useState<Set<string>>(new Set())
  const [consumidos, setConsumidos] = React.useState(0)
  const [ultima, setUltima] = React.useState<{
    sendId: string
    assignmentId: string
    /** Si liberar esta marca devuelve un lugar del cupo. Solo las aperturas. */
    gastoCupo: boolean
  } | null>(null)
  const [sinSincronizar, setSinSincronizar] = React.useState(0)

  // Al confirmar un cambio de cuenta el contador arranca de cero: lo consumido
  // pertenecía a la cuenta anterior.
  const cuentaActivaId = cola.cupo.activa?.id ?? null
  React.useEffect(() => {
    setConsumidos(0)
  }, [cuentaActivaId])

  const sinHacer = React.useCallback(
    (lista: ItemDeCola[]) => lista.filter((i) => !hechos.has(i.assignmentId)),
    [hechos],
  )
  const aperturas = React.useMemo(() => sinHacer(cola.aperturas), [cola.aperturas, sinHacer])
  const seguimientos = React.useMemo(
    () => sinHacer(cola.seguimientos),
    [cola.seguimientos, sinHacer],
  )

  const atrasados = seguimientos.filter((i) => i.diasAtraso > 0).length
  const pendientes = seccion === 'apertura' ? aperturas : seguimientos
  const actual = pendientes[0] ?? null
  const laOtra: Seccion = seccion === 'apertura' ? 'seguimiento' : 'apertura'
  const quedanEnLaOtra = (seccion === 'apertura' ? seguimientos : aperturas).length

  const restante = Math.max((cola.cupo.activa?.restante ?? 0) - consumidos, 0)
  const usado = (cola.cupo.activa?.enviadosHoy ?? 0) + consumidos
  const alTope = cola.cupo.activa !== null && restante === 0

  /*
   * El tope frena una lista y no la otra.
   *
   * Llegar al límite del día tapaba la cola entera con el cartel de "terminaste
   * por hoy", y adentro quedaban las ofertas y los seguimientos: mensajes que
   * salen en chats ya abiertos y no gastan cupo. El setter conseguía que le
   * contestaran y no podía responder hasta el día siguiente.
   *
   * Con las listas separadas la regla se lee sola: el cupo es el presupuesto de
   * abrir chats, así que frena la lista de contactar y a la de seguimiento no
   * la toca nunca.
   */
  const frenadoPorCupo = alTope && seccion === 'apertura'
  const debeCambiar = frenadoPorCupo && cola.cupo.siguiente !== null
  const terminoPorCupo = frenadoPorCupo && cola.cupo.siguiente === null

  // Lo que espera en la cuenta a la que tendría que cambiar. Las dos listas
  // suman: los dos tienen el hilo ahí y de otra cuenta no pueden salir.
  const enLaSiguiente = cola.porCuenta.find((c) => c.cuentaId === cola.cupo.siguiente?.id)
  const esperandoEnLaSiguiente = (enLaSiguiente?.seguimientos ?? 0) + (enLaSiguiente?.aperturas ?? 0)

  /* ── Marcas guardadas sin señal ─────────────────────────────────────── */

  const sincronizar = React.useCallback(() => {
    void outbox.sincronizar(marcarEnviado).then(({ enviadas, quedan }) => {
      setSinSincronizar(quedan)
      if (enviadas > 0) {
        toast.success(
          enviadas === 1 ? 'Se sincronizó 1 marca' : `Se sincronizaron ${enviadas} marcas`,
        )
        router.refresh()
      }
    })
  }, [router])

  React.useEffect(() => {
    setSinSincronizar(outbox.pendientes().length)
    sincronizar()
    window.addEventListener('online', sincronizar)
    return () => window.removeEventListener('online', sincronizar)
  }, [sincronizar])

  /* ── Acciones ───────────────────────────────────────────────────────── */

  const avanzar = React.useCallback((assignmentId: string) => {
    setHechos((s) => new Set(s).add(assignmentId))
  }, [])

  const abrir = React.useCallback(
    (item: ItemDeCola) => {
      if (!item.mensaje) return

      /*
       * Esto corre **dentro** del toque sobre el enlace y sin cancelarlo: la
       * navegación a Instagram sigue su camino sola. Es a propósito, porque el
       * sistema operativo solo le entrega el link a la app cuando el toque fue
       * sobre un enlace de verdad; abrirlo desde acá con código lo dejaba en
       * el navegador.
       *
       * No existe forma de precargar el texto de un DM de Instagram, así que
       * el portapapeles es el camino, y el copiado tiene que pasar acá: una
       * vez que la pantalla cambió de app ya no se puede escribir en él.
       */
      void copiarAlPortapapeles(item.mensaje).then((ok) => {
        if (ok) toast.success('Mensaje copiado — pegá con mantener presionado')
        else toast.error('No se pudo copiar. Mantené presionado el mensaje y copialo a mano.')
      })

      setAbiertos((s) => new Set(s).add(item.assignmentId))
      void abrirChat(item.assignmentId)
    },
    [],
  )

  const marcar = React.useCallback(
    (item: ItemDeCola) => {
      // Se avanza en la pantalla enseguida: el setter ya mandó el mensaje, y
      // esperar a la red con el pulgar en el aire es lo que hace que marque dos
      // veces.
      avanzar(item.assignmentId)
      // El medidor se adelanta al servidor, pero solo con lo que de verdad
      // gasta: un seguimiento no descuenta nada, y sumarlo acá le mostraba al
      // setter un cupo consumido que no existía.
      const gastoCupo = item.seccion === 'apertura'
      if (gastoCupo) setConsumidos((n) => n + 1)

      iniciar(async () => {
        try {
          const r = await marcarEnviado(item.assignmentId)
          if (!r.ok) {
            setHechos((s) => {
              const n = new Set(s)
              n.delete(item.assignmentId)
              return n
            })
            if (gastoCupo) setConsumidos((n) => Math.max(n - 1, 0))
            toast.error(r.error ?? 'No se pudo registrar.')
            if (r.requiereCambioDeCuenta) router.refresh()
            return
          }

          if (r.sendId) {
            setUltima({ sendId: r.sendId, assignmentId: item.assignmentId, gastoCupo })
          }
          if (!r.duplicado) {
            toast.success(
              gastoCupo
                ? `Enviado · ${r.usadoHoy}/${r.cupo} con esta cuenta`
                : 'Enviado · el seguimiento no gasta cupo',
            )
          }
        } catch {
          // Sin señal: la marca no se pierde, se guarda y sale sola después.
          outbox.encolar(item.assignmentId)
          setSinSincronizar(outbox.pendientes().length)
          toast.message('Guardado sin señal', {
            description: 'Se sincroniza solo cuando vuelva la conexión.',
          })
        }
      })
    },
    [avanzar, router],
  )

  const saltear = React.useCallback(
    (item: ItemDeCola) => {
      avanzar(item.assignmentId)
      iniciar(async () => {
        const r = await saltearLead(item.assignmentId)
        if (!r.ok) {
          toast.error(r.error ?? 'No se pudo saltear.')
          return
        }
        // Entró otro en su lugar: la cola de abajo cambió y conviene decirlo,
        // porque el que saltea espera quedarse con uno menos.
        if (r.repuestos && r.repuestos > 0) {
          toast.success('Salteado. Te entró otro del pozo.')
          router.refresh()
        }
      })
    },
    [avanzar, router],
  )

  const descartar = React.useCallback(
    (item: ItemDeCola) => {
      avanzar(item.assignmentId)
      iniciar(async () => {
        const r = await descartarLead(item.assignmentId)
        if (!r.ok) toast.error(r.error ?? 'No se pudo descartar.')
      })
    },
    [avanzar],
  )

  const noExiste = React.useCallback(
    (item: ItemDeCola) => {
      avanzar(item.assignmentId)
      iniciar(async () => {
        const r = await marcarCuentaInexistente(item.assignmentId)
        if (r.ok) toast.success('Marcado — se lo saca de la lista')
        else toast.error(r.error ?? 'No se pudo marcar.')
      })
    },
    [avanzar],
  )

  const deshacer = React.useCallback(() => {
    if (!ultima) return
    const u = ultima
    setUltima(null)
    iniciar(async () => {
      const r = await deshacerMarca(u.sendId)
      if (r.ok) {
        setHechos((s) => {
          const n = new Set(s)
          n.delete(u.assignmentId)
          return n
        })
        if (u.gastoCupo) setConsumidos((n) => Math.max(n - 1, 0))
        toast.success(u.gastoCupo ? 'Deshecho — el cupo se liberó' : 'Deshecho')
        router.refresh()
      } else {
        toast.error(r.error ?? 'No se pudo deshacer.')
      }
    })
  }, [ultima, router])

  const cambiarCuenta = React.useCallback(
    (cuentaId: string) => {
      iniciar(async () => {
        const r = await confirmarCambioDeCuenta(cuentaId)
        if (r.ok) {
          toast.success('Listo, seguí con la cuenta nueva')
          router.refresh()
        } else {
          toast.error(r.error ?? 'No se pudo cambiar.')
        }
      })
    },
    [router],
  )

  const pedirMas = React.useCallback(() => {
    iniciar(async () => {
      const r = await pedirMasLeads()
      if (r.ok) {
        toast.success(`Te tocaron ${r.entregados} leads`)
        router.refresh()
      } else {
        toast.error(r.error ?? 'No se pudo pedir más.')
      }
    })
  }, [router])

  /* ── Qué se muestra ─────────────────────────────────────────────────── */

  if (puerta.bloqueante && !bloqueanteConfirmado) {
    return (
      <CartelDeMensaje
        aviso={puerta.bloqueante}
        bloqueante
        onConfirmado={() => {
          setBloqueanteConfirmado(true)
          router.refresh()
        }}
      />
    )
  }

  const importante = puerta.importantes[importantesVistos]
  if (importante) {
    return (
      <CartelDeMensaje
        aviso={importante}
        bloqueante={false}
        onConfirmado={() => setImportantesVistos((n) => n + 1)}
      />
    )
  }

  if (puerta.recordatorio && !recordatorioVisto) {
    return (
      <CartelDeRecordatorio
        recordatorio={puerta.recordatorio}
        onCerrado={() => setRecordatorioVisto(true)}
      />
    )
  }

  if (cola.seguimientos.length > 0 && !seguimientosVistos) {
    return (
      <CartelDeSeguimientos
        cuantos={cola.seguimientos.length}
        atrasados={cola.seguimientosAtrasados}
        diasDeAtraso={cola.diasDeAtraso}
        porContactar={cola.aperturas.length}
        onEmpezar={() => {
          try {
            sessionStorage.setItem(CLAVE_SEGUIMIENTOS, new Date().toDateString())
          } catch {
            /* modo privado: se vuelve a mostrar, y está bien */
          }
          setSeguimientosVistos(true)
          setSeccion('seguimiento')
        }}
      />
    )
  }

  return (
    <div className="space-y-2.5">
      <Selector
        seccion={seccion}
        onElegir={setSeccion}
        aperturas={aperturas.length}
        seguimientos={seguimientos.length}
        atrasados={atrasados}
      />

      {seccion === 'apertura' ? (
        <Medidor
          usuario={cola.cupo.activa?.igUsername ?? null}
          usado={usado}
          cupo={cola.cupo.activa?.cupoDiario ?? 0}
          totalUsado={cola.cupo.usadoHoy + consumidos}
          totalCupo={cola.cupo.cupoTotal}
        />
      ) : (
        <CintaDeSeguimiento atrasados={atrasados} diasDeAtraso={cola.diasDeAtraso} />
      )}

      <SinSenal cuantas={sinSincronizar} />

      {/* Con más de una cuenta, cuál está usando y qué le falta en cada una. */}
      <Cuentas cuentas={cola.porCuenta} onCambio={() => router.refresh()} />

      {puerta.fijados.map((a) => (
        <AnuncioFijado key={a.id} aviso={a} />
      ))}

      {debeCambiar ? (
        <CartelDeCambio
          cuentaActual={cola.cupo.activa!.igUsername}
          cupo={cola.cupo.activa!.cupoDiario}
          siguiente={cola.cupo.siguiente}
          motivo={motivoDelCambio(cola.cupo)}
          onCambiar={cambiarCuenta}
          pendiente={pendiente}
          esperandoEnLaSiguiente={esperandoEnLaSiguiente}
        />
      ) : actual && !terminoPorCupo ? (
        <TarjetaDeLead
          item={actual}
          abierto={abiertos.has(actual.assignmentId)}
          pendiente={pendiente}
          restantes={pendientes.length}
          onAbrir={() => abrir(actual)}
          onEnviado={() => marcar(actual)}
          onSaltear={() => saltear(actual)}
          onNoExiste={() => noExiste(actual)}
          onDescartar={() => descartar(actual)}
          cuentaActiva={cola.cupo.activa?.igUsername ?? null}
        />
      ) : (
        <ListaTerminada
          seccion={seccion}
          hoy={cola.hoy}
          aperturasAhora={consumidos}
          terminoPorCupo={terminoPorCupo}
          cuentas={cola.cupo.cuentas.filter((c) => c.activa).length}
          quedanEnLaOtra={quedanEnLaOtra}
          onIrALaOtra={() => setSeccion(laOtra)}
          pendiente={pendiente}
          onPedirMas={pedirMas}
        />
      )}

      {ultima ? (
        <Button variant="fantasma" className="h-11 w-full" onClick={deshacer} disabled={pendiente}>
          <Undo2 aria-hidden />
          Deshacer la última marca
        </Button>
      ) : null}

      <ActivarAvisos clavePublica={clavePublica} />
      <CintaInstalar />
    </div>
  )
}

/* ── Elegir en qué está trabajando ────────────────────────────────────── */

/**
 * Las dos listas, arriba de todo y siempre a la vista.
 *
 * Es la pieza entera del cambio: antes había una sola cola y el setter no
 * tenía cómo saber si el lead que tenía adelante era un desconocido o alguien
 * con quien ya venía hablando. Ahora elige, y el nombre de lo que eligió está
 * escrito debajo con su consecuencia — gasta cupo o no gasta.
 *
 * Las dos se muestran aunque una esté en cero: que el número diga 0 es
 * información. Esconder la lista vacía deja al setter sin saber si terminó los
 * seguimientos o si la pantalla no se los muestra.
 */
function Selector({
  seccion,
  onElegir,
  aperturas,
  seguimientos,
  atrasados,
}: {
  seccion: Seccion
  onElegir: (s: Seccion) => void
  aperturas: number
  seguimientos: number
  atrasados: number
}) {
  const cuantos: Record<Seccion, number> = { apertura: aperturas, seguimiento: seguimientos }

  return (
    <div>
      <div role="tablist" aria-label="Qué estás haciendo" className="flex gap-1.5">
        {SECCIONES.map((s) => {
          const activa = s === seccion
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={activa}
              onClick={() => onElegir(s)}
              className={cn(
                'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5',
                'rounded-[6px] border px-2 py-1.5 transition-colors duration-150',
                activa
                  ? 'border-acento/45 bg-acento-tenue text-acento'
                  : 'border-borde bg-superficie text-texto-2',
              )}
            >
              <span className={cn('dato text-[17px] leading-none', activa ? '' : 'text-texto')}>
                {cuantos[s]}
              </span>
              <span className="text-[11.5px] font-medium leading-tight">
                {SECCION_META[s].corto}
              </span>
              {s === 'seguimiento' && atrasados > 0 ? (
                <span className="text-[10.5px] leading-none text-rojo">
                  {atrasados} {atrasados === 1 ? 'atrasado' : 'atrasados'}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="mt-1.5 px-0.5">
        <h1 className="text-[13.5px] font-medium text-texto">{SECCION_META[seccion].titulo}</h1>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-texto-2">
          {SECCION_META[seccion].detalle}
        </p>
      </div>
    </div>
  )
}

/* ── Medidor de cupo ──────────────────────────────────────────────────── */

/**
 * Solo aparece en la lista de contactar, porque es la única que lo gasta.
 *
 * Tenerlo arriba de los seguimientos era parte de la confusión: un número que
 * sube mientras trabajás y que ahí no se mueve nunca.
 */
function Medidor({
  usuario,
  usado,
  cupo,
  totalUsado,
  totalCupo,
}: {
  usuario: string | null
  usado: number
  cupo: number
  totalUsado: number
  totalCupo: number
}) {
  const llenos = cupo > 0 ? Math.min(Math.round((usado / cupo) * 10), 10) : 0
  const alTope = cupo > 0 && usado >= cupo

  return (
    <div className="rounded-[6px] border border-borde bg-superficie px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="dato text-[15px] text-texto">
          {usado}
          <span className="text-texto-2"> / {cupo}</span>
          {usuario ? <span className="ml-2 text-[12px] text-texto-2">@{usuario}</span> : null}
        </span>
        <span className="dato text-[11.5px] text-texto-2">
          hoy {totalUsado}/{totalCupo}
        </span>
      </div>

      <div
        className="mt-1.5 flex gap-[3px]"
        role="img"
        aria-label={`${usado} de ${cupo} con esta cuenta`}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-[1px]',
              i < llenos ? (alTope ? 'bg-rojo' : 'bg-ambar') : 'bg-borde/60',
            )}
          />
        ))}
      </div>

      <p className="mt-1.5 text-[11.5px] leading-relaxed text-texto-2">
        Cada chat que abrís descuenta uno. Los seguimientos no tocan este número.
      </p>
    </div>
  )
}

/**
 * Lo que va en el lugar del medidor cuando trabaja seguimientos.
 *
 * Ocupa el mismo lugar a propósito: es donde el ojo ya busca "cuánto me queda",
 * y lo que tiene que encontrar ahí es que acá no se gasta nada.
 */
function CintaDeSeguimiento({
  atrasados,
  diasDeAtraso,
}: {
  atrasados: number
  diasDeAtraso: number
}) {
  return (
    <div className="rounded-[6px] border border-borde bg-superficie px-3 py-2">
      <p className="flex items-center gap-1.5 text-[12.5px] text-texto">
        <Repeat className="h-3.5 w-3.5 text-verde" aria-hidden />
        El chat ya está abierto: no gasta cupo
      </p>
      {atrasados > 0 ? (
        <p className="mt-1 text-[11.5px] leading-relaxed text-rojo">
          {atrasados === 1 ? 'Hay 1 atrasado' : `Hay ${atrasados} atrasados`}
          {diasDeAtraso > 0
            ? ` — el más viejo, de hace ${diasDeAtraso === 1 ? '1 día' : `${diasDeAtraso} días`}.`
            : '.'}{' '}
          <span className="text-texto-2">
            Son los que más chance tienen de contestar: ya te leyeron una vez.
          </span>
        </p>
      ) : (
        <p className="mt-1 text-[11.5px] leading-relaxed text-texto-2">
          Ninguno atrasado. Estos son los que ya te contestaron o los que dejaste esperando.
        </p>
      )}
    </div>
  )
}

/** Las marcas que quedaron sin salir. Va en las dos listas: no es de ninguna. */
function SinSenal({ cuantas }: { cuantas: number }) {
  if (cuantas === 0) return null
  return (
    <p className="flex items-center gap-1.5 px-0.5 text-[11.5px] text-ambar">
      <CloudOff className="h-3.5 w-3.5" aria-hidden />
      {cuantas === 1 ? '1 marca guardada sin señal' : `${cuantas} marcas guardadas sin señal`}
    </p>
  )
}

/* ── Un lead ──────────────────────────────────────────────────────────── */

function TarjetaDeLead({
  item,
  abierto,
  pendiente,
  restantes,
  onAbrir,
  onEnviado,
  onSaltear,
  onNoExiste,
  onDescartar,
  cuentaActiva,
}: {
  item: ItemDeCola
  abierto: boolean
  pendiente: boolean
  restantes: number
  onAbrir: () => void
  onEnviado: () => void
  onSaltear: () => void
  onNoExiste: () => void
  onDescartar: () => void
  /** Con cuál está trabajando: sirve para avisar solo cuando el lead pide otra. */
  cuentaActiva: string | null
}) {
  /*
   * Un seguimiento sale de la cuenta que abrió esa conversación, no de la que
   * el setter tenga activa: en Instagram el hilo vive ahí. Si esa cuenta llegó
   * a su tope, el lead espera a mañana — cambiar de cuenta no ayuda, porque la
   * conversación no se mudó.
   *
   * Pero el tope solo frena a los que **abren** chat, que son exactamente los
   * de la lista de contactar. Un mensaje sobre una conversación que ya existe
   * no gasta cupo y el servidor lo deja pasar; si la app lo bloqueara igual, el
   * lead que contestó se quedaría sin respuesta por el presupuesto de abrir
   * desconocidos, que es justo al revés de lo que conviene.
   */
  const sinCupoEnSuCuenta = item.cuentaSinCupo && item.seccion === 'apertura'
  const bloqueado = item.mensaje === null || sinCupoEnSuCuenta
  const habilitado = (abierto || item.abierto) && !sinCupoEnSuCuenta

  /*
   * Guarda contra el toque fantasma.
   *
   * Al tocar "Enviado" la cola avanza en el acto y la tarjeta se reemplaza por
   * la del lead siguiente **dentro del mismo toque**. El `click` llega después
   * del cambio y le cae al botón nuevo que quedó abajo del dedo: se abría
   * Instagram sin que nadie lo pidiera, y peor, sobre el lead equivocado.
   *
   * Un cuarto de segundo sin recibir toques lo corta. No se nota al usar la
   * app —el dedo tarda más que eso en volver— y no hace falta cartel: nada
   * cambia de aspecto.
   */
  const [listo, setListo] = React.useState(false)
  React.useEffect(() => {
    setListo(false)
    const t = setTimeout(() => setListo(true), 250)
    return () => clearTimeout(t)
  }, [item.assignmentId])

  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-borde px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          {/*
            Qué mensaje es y de cuál de las dos listas salió. El chip dice las
            dos cosas porque son las dos que hay que saber antes de escribir: si
            el chat está abierto o no, y en qué escalón va.
          */}
          {item.seccion === 'seguimiento' ? (
            <Chip tono={item.diasAtraso > 0 ? 'negativo' : 'activo'}>
              <Repeat className="h-3 w-3" aria-hidden />
              {PASO_META[item.paso].label}
              {item.diasAtraso > 0 ? ` · ${item.diasAtraso}d de atraso` : ''}
            </Chip>
          ) : (
            <Chip>
              <Send className="h-3 w-3" aria-hidden />
              {/*
                El nombre corto del escalón, no el largo de PASO_META: en un chip
                de celular "No contestó la entrada · 1. Otra apertura" no entra.
              */}
              {item.paso === 1
                ? 'Primer mensaje'
                : (ubicacionDePaso(item.paso)?.paso.label ?? PASO_META[item.paso].label)}
            </Chip>
          )}

          {/* De qué cuenta sale. Solo cuando no es la activa: si coincide, decirlo
              es ruido. Cuando no, es la diferencia entre seguir una charla y
              escribirle de cero a alguien que ya te conoce. */}
          {item.cuentaUsuario && item.cuentaUsuario !== cuentaActiva ? (
            <Chip tono="activo">desde @{item.cuentaUsuario}</Chip>
          ) : null}
        </div>
        <span className="dato text-[11px] text-texto-2">quedan {restantes}</span>
      </div>

      <div className="px-3 py-3">
        <h2 className="text-[19px] leading-tight">{item.businessName}</h2>
        <p className="dato mt-0.5 text-[13px] text-ambar">@{item.igUsername}</p>
        <p className="mt-0.5 text-[12.5px] text-texto-2">
          {[item.niche, item.city].filter(Boolean).join(' · ') || 'Sin datos extra'}
        </p>

        {sinCupoEnSuCuenta ? (
          <div className="mt-3 rounded-[5px] border border-ambar/35 bg-ambar-tenue px-2.5 py-2">
            <p className="text-[13px] font-medium text-ambar">Esta conversación sigue mañana</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-texto-2">
              Le escribiste desde @{item.cuentaUsuario}, y esa cuenta llegó a su límite de hoy.
              El seguimiento tiene que salir de ahí, así que no sirve cambiar de cuenta.
            </p>
          </div>
        ) : bloqueado ? (
          <div className="mt-3 rounded-[5px] border border-rojo/35 bg-rojo-tenue px-2.5 py-2">
            <p className="text-[13px] font-medium text-rojo">No se puede armar el mensaje</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-texto-2">
              {item.motivoBloqueo} Salteálo y avisale al administrador.
            </p>
          </div>
        ) : (
          <div className="mt-3 rounded-[5px] border border-borde bg-fondo px-2.5 py-2">
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-texto">
              {item.mensaje}
            </p>
          </div>
        )}

        {item.horasRestantes <= 12 && item.paso === 1 ? (
          <p className="mt-2 text-[12px] text-ambar">
            {item.horasRestantes === 0
              ? 'Vence en menos de una hora: si no lo contactás, vuelve al pozo.'
              : `Te quedan ${item.horasRestantes} h antes de que vuelva al pozo.`}
          </p>
        ) : null}
      </div>

      <div className={cn('space-y-2 border-t border-borde px-3 py-3', !listo && 'pointer-events-none')}>
        {/*
          Solo cuando abre chat. Un DM de una cuenta que la persona no sigue le
          cae en solicitudes, donde puede no mirar nunca; respondiendo una
          historia el mismo texto entra derecho a su bandeja. En los
          seguimientos no hace falta decirlo: el hilo ya está abierto.
        */}
        {!bloqueado && item.seccion === 'apertura' ? (
          <div className="rounded-[5px] border border-acento/30 bg-acento-tenue px-2.5 py-2">
            <p className="text-[12.5px] font-medium text-acento">
              ¿Tiene historia subida? Respondele la historia.
            </p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-texto-2">
              Pegá este mismo mensaje ahí. Un mensaje suelto le cae en solicitudes y capaz no lo
              ve nunca; una respuesta a la historia le llega a la bandeja y la abre.
            </p>
          </div>
        ) : null}

        {!bloqueado ? (
          <AbrirInstagram
            link={item.linkDirecto}
            onAbrir={onAbrir}
            bloqueado={!listo}
            variant={habilitado ? 'secundaria' : 'primaria'}
            className="h-12 w-full text-[14px]"
          >
            <ExternalLink aria-hidden />
            Abrir Instagram
          </AbrirInstagram>
        ) : null}

        <div className="flex gap-2">
          <Button
            variant="positiva"
            className="h-12 flex-1 text-[14px]"
            onClick={onEnviado}
            disabled={pendiente || bloqueado || !habilitado}
            title={
              habilitado
                ? 'Confirma que el mensaje salió. Recién acá se consume el cupo.'
                : 'Primero abrí el chat.'
            }
          >
            <Check aria-hidden />
            Enviado
          </Button>
          <Button variant="secundaria" className="h-12 flex-1" onClick={onSaltear} disabled={pendiente}>
            <SkipForward aria-hidden />
            Saltear
          </Button>
        </div>

        {!habilitado && !bloqueado ? (
          <p className="text-center text-[11.5px] text-texto-2">
            Se habilita cuando abrís el chat.
          </p>
        ) : null}

        {/*
          Las dos formas de sacarlo de la lista, y son distintas: "no existe" es
          un hecho sobre el perfil, "no sirve" es un juicio sobre el negocio.
          Sin la segunda, el lead malo no se va nunca: se saltea, vuelve mañana,
          vence, y de ahí se lo lleva otro que lo saltea igual.
        */}
        <div className="flex gap-2">
          <Button
            variant="destructiva"
            className="h-11 flex-1 text-[12.5px]"
            onClick={onNoExiste}
            disabled={pendiente}
            title="El perfil de Instagram no existe o está caído."
          >
            <UserX aria-hidden />
            No existe
          </Button>
          <Button
            variant="destructiva"
            className="h-11 flex-1 text-[12.5px]"
            onClick={onDescartar}
            disabled={pendiente}
            title="Existe, pero no es alguien a quien tenga sentido escribirle."
          >
            <Ban aria-hidden />
            No sirve
          </Button>
        </div>
      </div>
    </Panel>
  )
}

/* ── Cuando una de las dos listas se termina ──────────────────────────── */

/**
 * Terminar los seguimientos y terminar el día no son lo mismo.
 *
 * Antes había un solo cartel para las dos cosas, porque había una sola cola:
 * vaciarla decía "Día completado" aunque el setter tuviera veinte leads sin
 * contactar esperando. Ahora cada lista se termina por su cuenta y el cartel
 * dice cuál, con el paso siguiente adelante: la otra lista, o pedir más leads.
 */
function ListaTerminada({
  seccion,
  hoy,
  aperturasAhora,
  terminoPorCupo,
  cuentas,
  quedanEnLaOtra,
  onIrALaOtra,
  pendiente,
  onPedirMas,
}: {
  seccion: Seccion
  hoy: ResumenDelDia
  /** Aperturas marcadas en esta sesión, por si el servidor todavía no las tiene. */
  aperturasAhora: number
  terminoPorCupo: boolean
  cuentas: number
  quedanEnLaOtra: number
  onIrALaOtra: () => void
  pendiente: boolean
  onPedirMas: () => void
}) {
  const aperturas = Math.max(hoy.aperturas, aperturasAhora)
  const esSeguimiento = seccion === 'seguimiento'

  /*
   * Arrancar el día y terminarlo no son la misma pantalla, aunque las dos
   * tengan la lista vacía. Decirle "listo" a alguien que todavía no mandó nada
   * lo deja sin saber si tiene que hacer algo o no.
   */
  const arrancando = !esSeguimiento && aperturas === 0 && hoy.seguimientos === 0

  const titulo = esSeguimiento
    ? 'Seguimientos al día'
    : arrancando
      ? 'Listo para arrancar'
      : terminoPorCupo
        ? 'Llegaste al límite de hoy'
        : 'Contactaste a todos los de hoy'

  const verde = esSeguimiento || (!arrancando && !terminoPorCupo)

  return (
    <Panel className="px-4 py-6 text-center">
      <div
        className={cn(
          'mx-auto flex h-11 w-11 items-center justify-center rounded-[6px] border',
          verde ? 'border-verde/35 bg-verde-tenue' : 'border-acento/35 bg-acento-tenue',
        )}
      >
        {verde ? (
          <Check className="h-5 w-5 text-verde" aria-hidden />
        ) : (
          <Send className="h-5 w-5 text-acento" aria-hidden />
        )}
      </div>

      <h2 className="mt-3 text-[19px]">{titulo}</h2>

      {esSeguimiento ? (
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-texto-2">
          No quedan conversaciones esperando respuesta. Las que sigan calladas te van a volver a
          aparecer acá el día que les toque.
        </p>
      ) : arrancando ? (
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-texto-2">
          Todavía no tenés leads asignados. Pedí los de hoy y empezá.
        </p>
      ) : (
        <dl className="mx-auto mt-4 max-w-[240px] space-y-1.5">
          <Linea rotulo="chats abiertos" valor={aperturas} />
          <Linea rotulo="seguimientos" valor={hoy.seguimientos} />
          <Linea rotulo="respondieron" valor={hoy.respondieron} />
          <Linea rotulo="pasaron al equipo" valor={hoy.respondieron + hoy.reuniones} />
        </dl>
      )}

      {/*
        Lo primero que hay que ofrecer es la otra lista: es trabajo que está
        esperando ahora. Pedir más leads recién tiene sentido cuando no queda
        nada de nada.
      */}
      {quedanEnLaOtra > 0 ? (
        <Button variant="primaria" className="mt-4 h-14 w-full text-[15px]" onClick={onIrALaOtra}>
          <Repeat aria-hidden />
          {esSeguimiento
            ? `Contactar los ${quedanEnLaOtra} de hoy`
            : `Te faltan ${quedanEnLaOtra} ${quedanEnLaOtra === 1 ? 'seguimiento' : 'seguimientos'}`}
        </Button>
      ) : terminoPorCupo ? (
        <p className="mt-4 text-[13px] leading-relaxed text-texto-2">
          {cuentas > 1
            ? 'Tus cuentas llegaron al límite de hoy. Seguí mañana.'
            : 'Tu cuenta llegó al límite de hoy. Seguí mañana.'}
        </p>
      ) : (
        <Button
          variant="primaria"
          className="mt-4 h-14 w-full text-[15px]"
          onClick={onPedirMas}
          disabled={pendiente}
        >
          <Send aria-hidden />
          {pendiente ? 'Pidiendo…' : arrancando ? 'Quiero mis leads de hoy' : 'Pedir más leads'}
        </Button>
      )}
    </Panel>
  )
}

function Linea({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <dd className="dato w-10 shrink-0 text-right text-[18px] text-texto">{valor}</dd>
      <dt className="text-[13px] text-texto-2">{rotulo}</dt>
    </div>
  )
}

'use client'

import {
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

import { ActivarAvisos, CintaInstalar } from '@/components/setter/pwa'
import { Button } from '@/components/ui/button'
import { Chip, Panel } from '@/components/ui/panel'
import { PASO_META } from '@/lib/mensajes-config'
import { abrirEnInstagram } from '@/lib/abrir-instagram'
import { copiarAlPortapapeles } from '@/lib/copiar'
import { motivoDelCambio } from '@/lib/setters-cupo'
import * as outbox from '@/lib/outbox'
import { cn } from '@/lib/utils'
import {
  abrirChat,
  confirmarCambioDeCuenta,
  deshacerMarca,
  marcarCuentaInexistente,
  marcarEnviado,
  pedirMasLeads,
  saltearLead,
} from '@/server/actions/setter'
import type { ColaDelSetter, ItemDeCola } from '@/server/setters/cola'
import type { PuertaDeEntrada } from '@/server/setters/avisos'

import {
  AnuncioFijado,
  CartelDeCambio,
  CartelDeMensaje,
  CartelDeRecordatorio,
  CartelDeSeguimientos,
} from './carteles'

/**
 * La cola del día.
 *
 * Un lead a la vez. El trabajo entero es: mirar el negocio, tocar "Abrir
 * Instagram" (que copia el mensaje y abre el chat), pegar, mandar, y volver a
 * tocar "Enviado". Dos toques en la app y nada que escribir.
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
    if (cola.seguimientos === 0) return
    try {
      const hoy = new Date().toDateString()
      setSeguimientosVistos(sessionStorage.getItem(CLAVE_SEGUIMIENTOS) === hoy)
    } catch {
      setSeguimientosVistos(false)
    }
  }, [cola.seguimientos])

  /* ── Estado de la cola ──────────────────────────────────────────────── */
  const [hechos, setHechos] = React.useState<Set<string>>(new Set())
  const [abiertos, setAbiertos] = React.useState<Set<string>>(new Set())
  const [consumidos, setConsumidos] = React.useState(0)
  const [ultima, setUltima] = React.useState<{ sendId: string; assignmentId: string } | null>(null)
  const [sinSincronizar, setSinSincronizar] = React.useState(0)

  // Al confirmar un cambio de cuenta el contador arranca de cero: lo consumido
  // pertenecía a la cuenta anterior.
  const cuentaActivaId = cola.cupo.activa?.id ?? null
  React.useEffect(() => {
    setConsumidos(0)
  }, [cuentaActivaId])

  const pendientes = React.useMemo(
    () => cola.items.filter((i) => !hechos.has(i.assignmentId)),
    [cola.items, hechos],
  )
  const actual = pendientes[0] ?? null

  const restante = Math.max((cola.cupo.activa?.restante ?? 0) - consumidos, 0)
  const usado = (cola.cupo.activa?.enviadosHoy ?? 0) + consumidos
  const alTope = cola.cupo.activa !== null && restante === 0
  const debeCambiar = alTope && cola.cupo.siguiente !== null
  const terminoPorCupo = alTope && cola.cupo.siguiente === null

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
       * No existe forma de precargar el texto de un DM de Instagram. El
       * portapapeles es el camino: se copia primero y recién después se abre
       * el chat, porque una vez que el navegador cambia de app ya no se puede
       * escribir en el portapapeles.
       *
       * El copiado no puede impedir la apertura. Antes iba directo a
       * `navigator.clipboard`, que no existe sin HTTPS, y la excepción se
       * llevaba puesto el `window.open` de abajo: se tocaba "Abrir Instagram"
       * y no pasaba nada.
       */
      void copiarAlPortapapeles(item.mensaje).then((ok) => {
        if (ok) toast.success('Mensaje copiado — pegá con mantener presionado')
        else toast.error('No se pudo copiar. Mantené presionado el mensaje y copialo a mano.')
      })

      abrirEnInstagram(item.linkDirecto)
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
      setConsumidos((n) => n + 1)

      iniciar(async () => {
        try {
          const r = await marcarEnviado(item.assignmentId)
          if (!r.ok) {
            setHechos((s) => {
              const n = new Set(s)
              n.delete(item.assignmentId)
              return n
            })
            setConsumidos((n) => Math.max(n - 1, 0))
            toast.error(r.error ?? 'No se pudo registrar.')
            if (r.requiereCambioDeCuenta) router.refresh()
            return
          }

          if (r.sendId) setUltima({ sendId: r.sendId, assignmentId: item.assignmentId })
          if (!r.duplicado) {
            toast.success(`Enviado · ${r.usadoHoy}/${r.cupo} con esta cuenta`)
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
        if (!r.ok) toast.error(r.error ?? 'No se pudo saltear.')
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
        setConsumidos((n) => Math.max(n - 1, 0))
        toast.success('Deshecho — el cupo se liberó')
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

  if (cola.seguimientos > 0 && !seguimientosVistos) {
    return (
      <CartelDeSeguimientos
        cuantos={cola.seguimientos}
        atrasados={cola.seguimientosAtrasados}
        diasDeAtraso={cola.diasDeAtraso}
        onEmpezar={() => {
          try {
            sessionStorage.setItem(CLAVE_SEGUIMIENTOS, new Date().toDateString())
          } catch {
            /* modo privado: se vuelve a mostrar, y está bien */
          }
          setSeguimientosVistos(true)
        }}
      />
    )
  }

  return (
    <div className="space-y-2.5">
      <Medidor
        usuario={cola.cupo.activa?.igUsername ?? null}
        usado={usado}
        cupo={cola.cupo.activa?.cupoDiario ?? 0}
        totalUsado={cola.cupo.usadoHoy + consumidos}
        totalCupo={cola.cupo.cupoTotal}
        sinSincronizar={sinSincronizar}
      />

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
        />
      ) : (
        <DiaCompletado
          hoy={cola.hoy}
          contactadosAhora={consumidos}
          terminoPorCupo={terminoPorCupo}
          cuentas={cola.cupo.cuentas.filter((c) => c.activa).length}
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

/* ── Medidor de cupo ──────────────────────────────────────────────────── */

function Medidor({
  usuario,
  usado,
  cupo,
  totalUsado,
  totalCupo,
  sinSincronizar,
}: {
  usuario: string | null
  usado: number
  cupo: number
  totalUsado: number
  totalCupo: number
  sinSincronizar: number
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

      <div className="mt-1.5 flex gap-[3px]" role="img" aria-label={`${usado} de ${cupo} con esta cuenta`}>
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

      {sinSincronizar > 0 ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-ambar">
          <CloudOff className="h-3.5 w-3.5" aria-hidden />
          {sinSincronizar === 1
            ? '1 marca guardada sin señal'
            : `${sinSincronizar} marcas guardadas sin señal`}
        </p>
      ) : null}
    </div>
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
}: {
  item: ItemDeCola
  abierto: boolean
  pendiente: boolean
  restantes: number
  onAbrir: () => void
  onEnviado: () => void
  onSaltear: () => void
  onNoExiste: () => void
}) {
  const bloqueado = item.mensaje === null
  const habilitado = abierto || item.abierto

  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-borde px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          {item.paso > 1 ? (
            <Chip tono={item.diasAtraso > 0 ? 'negativo' : 'activo'}>
              <Repeat className="h-3 w-3" aria-hidden />
              {PASO_META[item.paso].label}
              {item.diasAtraso > 0 ? ` · ${item.diasAtraso}d de atraso` : ''}
            </Chip>
          ) : (
            <Chip>Primer mensaje</Chip>
          )}
        </div>
        <span className="dato text-[11px] text-texto-2">quedan {restantes}</span>
      </div>

      <div className="px-3 py-3">
        <h2 className="text-[19px] leading-tight">{item.businessName}</h2>
        <p className="dato mt-0.5 text-[13px] text-ambar">@{item.igUsername}</p>
        <p className="mt-0.5 text-[12.5px] text-texto-2">
          {[item.niche, item.city].filter(Boolean).join(' · ') || 'Sin datos extra'}
        </p>

        {bloqueado ? (
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

      <div className="space-y-2 border-t border-borde px-3 py-3">
        {!bloqueado ? (
          <Button
            variant={habilitado ? 'secundaria' : 'primaria'}
            className="h-12 w-full text-[14px]"
            onClick={onAbrir}
          >
            <ExternalLink aria-hidden />
            Abrir Instagram
          </Button>
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

        <Button
          variant="destructiva"
          className="h-11 w-full"
          onClick={onNoExiste}
          disabled={pendiente}
        >
          <UserX aria-hidden />
          No existe la cuenta
        </Button>
      </div>
    </Panel>
  )
}

/* ── Día completado ───────────────────────────────────────────────────── */

function DiaCompletado({
  hoy,
  contactadosAhora,
  terminoPorCupo,
  cuentas,
  pendiente,
  onPedirMas,
}: {
  hoy: { contactados: number; respondieron: number; reuniones: number }
  contactadosAhora: number
  terminoPorCupo: boolean
  cuentas: number
  pendiente: boolean
  onPedirMas: () => void
}) {
  const contactados = Math.max(hoy.contactados, contactadosAhora)

  /*
   * Arrancar el día y terminarlo no son la misma pantalla, aunque las dos
   * tengan la cola vacía. Decirle "Día completado" a alguien que todavía no
   * mandó nada lo deja sin saber si tiene que hacer algo o no.
   */
  const arrancando = contactados === 0

  return (
    <Panel className="px-4 py-6 text-center">
      <div
        className={cn(
          'mx-auto flex h-11 w-11 items-center justify-center rounded-[6px] border',
          arrancando ? 'border-acento/35 bg-acento-tenue' : 'border-verde/35 bg-verde-tenue',
        )}
      >
        {arrancando ? (
          <Send className="h-5 w-5 text-acento" aria-hidden />
        ) : (
          <Check className="h-5 w-5 text-verde" aria-hidden />
        )}
      </div>

      <h2 className="mt-3 text-[19px]">{arrancando ? 'Listo para arrancar' : 'Día completado'}</h2>

      {arrancando ? (
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-texto-2">
          Todavía no tenés leads asignados. Pedí los de hoy y empezá.
        </p>
      ) : (
        <dl className="mx-auto mt-4 max-w-[220px] space-y-1.5">
          <Linea rotulo="contactados" valor={contactados} />
          <Linea rotulo="respondieron" valor={hoy.respondieron} />
          <Linea rotulo="pasaron al equipo" valor={hoy.respondieron + hoy.reuniones} />
        </dl>
      )}

      {terminoPorCupo ? (
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

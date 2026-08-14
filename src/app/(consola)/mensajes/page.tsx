import { ExternalLink } from 'lucide-react'
import Link from 'next/link'
import type { Metadata } from 'next'

import { Button } from '@/components/ui/button'
import { diagnosticarEmbed, mismoDominioRaiz } from '@/server/chatwoot/embed'
import { leerConfigVisible } from '@/server/chatwoot/config'

import { MarcoChatwoot } from './marco'

export const metadata: Metadata = { title: 'Mensajes · Consola' }
export const dynamic = 'force-dynamic'

export default async function PaginaMensajes({
  searchParams,
}: {
  searchParams: Promise<{ conversacion?: string }>
}) {
  const { conversacion } = await searchParams
  const config = await leerConfigVisible()
  const urlDelCrm = process.env.AUTH_URL ?? 'http://localhost:3000'

  const base = config?.baseUrl ?? null
  const destino =
    base && config
      ? conversacion
        ? `${base}/app/accounts/${config.accountId}/conversations/${conversacion}`
        : `${base}/app/accounts/${config.accountId}/dashboard`
      : ''

  const diagnostico = await diagnosticarEmbed(base, new URL(urlDelCrm).origin)
  const dominiosDistintos = base ? !mismoDominioRaiz(urlDelCrm, base) : false

  const sync = config?.sincronizacion

  return (
    // La sección ocupa el alto completo y se sale del padding del layout: la
    // bandeja tiene que sentirse parte de la app, no una tarjeta con un sitio
    // adentro.
    <div className="-mx-2 -my-3 flex h-[calc(100dvh-2.75rem)] flex-col sm:-mx-3 sm:-my-4">
      {/* ── Barra fina ────────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-borde bg-superficie px-3 py-1.5">
        <div className="min-w-0">
          <h1 className="text-[14px] leading-tight">Mensajes</h1>
          <p className="text-[11px] text-texto-2">WhatsApp e Instagram vía Chatwoot</p>
        </div>

        {sync ? (
          <span
            className="flex items-center gap-1.5 text-[11.5px]"
            title={sync.motivo}
          >
            <span
              className={
                'block h-1.5 w-1.5 rounded-full ' +
                (sync.estado === 'verde'
                  ? 'bg-verde'
                  : sync.estado === 'rojo'
                    ? 'bg-rojo'
                    : 'bg-ambar')
              }
              aria-hidden
            />
            <span
              className={
                sync.estado === 'verde'
                  ? 'text-verde'
                  : sync.estado === 'rojo'
                    ? 'text-rojo'
                    : 'text-ambar'
              }
            >
              {sync.estado === 'verde'
                ? 'sincronizado'
                : sync.estado === 'rojo'
                  ? 'webhook caído'
                  : 'sin novedades'}
            </span>
          </span>
        ) : null}

        {conversacion ? (
          <Button asChild variant="fantasma" size="sm">
            <Link href="/mensajes">Ver toda la bandeja</Link>
          </Button>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          {destino ? (
            <Button asChild variant="secundaria" size="sm">
              <a href={destino} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden />
                Abrir en pestaña nueva
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      {/* ── Avisos que no se pueden ignorar ───────────────────────────── */}
      {sync?.estado === 'rojo' ? (
        <div
          role="alert"
          className="shrink-0 border-b border-rojo/35 bg-rojo/10 px-3 py-1.5 text-[11.5px] text-texto"
        >
          <span className="dato font-semibold uppercase tracking-wider text-rojo">Atención</span>{' '}
          {sync.motivo} Hasta que vuelva, la consola no se entera de las respuestas y puede seguir
          mandando seguimientos a gente que ya te contestó.
        </div>
      ) : null}

      {dominiosDistintos ? (
        <div className="shrink-0 border-b border-ambar/30 bg-ambar/8 px-3 py-1 text-[11px] text-texto-2">
          La consola y Chatwoot están en dominios raíz distintos. El navegador puede bloquear la
          cookie de sesión acá adentro y pedirte login una y otra vez. Lo ideal es servirlos bajo el
          mismo dominio: <span className="dato text-texto">crm.tudominio.com</span> y{' '}
          <span className="dato text-texto">chat.tudominio.com</span>.
        </div>
      ) : null}

      {/* ── La bandeja ────────────────────────────────────────────────── */}
      {config && destino ? (
        <MarcoChatwoot
          url={destino}
          diagnostico={diagnostico}
          avisarLogin={diagnostico.estado === 'ok'}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="max-w-md text-center">
            <h2 className="text-[15px]">Falta conectar Chatwoot</h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-texto-2">
              La bandeja es Chatwoot embebido: no se construye una propia. Cargá la URL, el id de
              cuenta y el token, y esta pantalla pasa a ser tu bandeja de las 10 cuentas de WhatsApp
              y las de Instagram, en un solo lugar.
            </p>
            <Button asChild variant="primaria" className="mt-4">
              <Link href="/configuracion">Ir a Configuración</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

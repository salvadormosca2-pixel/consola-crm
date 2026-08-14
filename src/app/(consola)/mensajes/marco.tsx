'use client'

import { ExternalLink, RefreshCw } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DiagnosticoEmbed } from '@/server/chatwoot/embed'

/**
 * El iframe de Chatwoot.
 *
 * Ocupa todo el alto disponible y no se envuelve en ningún contenedor con
 * scroll propio: Chatwoot ya tiene el suyo, y anidar dos scrolls hace que la
 * bandeja se sienta un sitio adentro de otro sitio en vez de parte de la app.
 */
export function MarcoChatwoot({
  url,
  diagnostico,
  avisarLogin,
}: {
  url: string
  diagnostico: DiagnosticoEmbed
  avisarLogin: boolean
}) {
  const [estado, setEstado] = React.useState<'cargando' | 'listo' | 'vacio'>('cargando')
  const [intento, setIntento] = React.useState(0)
  const ref = React.useRef<HTMLIFrameElement>(null)

  /*
   * No se puede leer el contenido de un iframe de otro dominio, así que el
   * bloqueo se detecta por tiempo: si a los 5 segundos no cargó, se muestra la
   * explicación. Nunca un panel en blanco sin decir qué pasó.
   */
  React.useEffect(() => {
    if (estado !== 'cargando') return
    const t = setTimeout(() => setEstado((e) => (e === 'cargando' ? 'vacio' : e)), 5000)
    return () => clearTimeout(t)
  }, [estado, intento])

  const bloqueadoPorCabeceras = diagnostico.estado === 'bloqueado'
  const noLlega = diagnostico.estado === 'inalcanzable'
  const mostrarProblema = bloqueadoPorCabeceras || noLlega || estado === 'vacio'

  if (mostrarProblema) {
    return <Explicacion url={url} diagnostico={diagnostico} onReintentar={() => {
      setEstado('cargando')
      setIntento((i) => i + 1)
    }} />
  }

  return (
    <div className="relative flex-1">
      {avisarLogin ? (
        <div className="border-b border-borde bg-elevada/50 px-3 py-1 text-[11.5px] text-texto-2">
          La primera vez te va a pedir el usuario de Chatwoot. Iniciás sesión una vez y queda
          guardado en el navegador.
        </div>
      ) : null}

      {estado === 'cargando' ? (
        <div className="absolute inset-0 flex items-center justify-center bg-fondo">
          <span className="text-[12.5px] text-texto-2">Abriendo la bandeja…</span>
        </div>
      ) : null}

      <iframe
        key={intento}
        ref={ref}
        src={url}
        title="Bandeja de Chatwoot"
        onLoad={() => setEstado('listo')}
        onError={() => setEstado('vacio')}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="clipboard-write; microphone"
        className={cn('h-full w-full border-0', estado === 'cargando' && 'invisible')}
      />
    </div>
  )
}

function Explicacion({
  url,
  diagnostico,
  onReintentar,
}: {
  url: string
  diagnostico: DiagnosticoEmbed
  onReintentar: () => void
}) {
  const titulo =
    diagnostico.estado === 'bloqueado'
      ? 'Chatwoot no se deja mostrar acá adentro'
      : diagnostico.estado === 'inalcanzable'
        ? 'No se pudo llegar a Chatwoot'
        : diagnostico.estado === 'sin_configurar'
          ? 'Falta configurar Chatwoot'
          : 'La bandeja quedó en blanco'

  return (
    <div className="flex-1 overflow-y-auto px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-[16px]">{titulo}</h2>

        <p className="mt-1.5 text-[12.5px] leading-relaxed text-texto-2">
          {diagnostico.estado === 'ok'
            ? 'Las cabeceras del servidor están bien, así que puede ser un problema de red o que Chatwoot haya tardado más de lo esperado.'
            : diagnostico.detalle}
        </p>

        {diagnostico.estado === 'bloqueado' ? (
          <>
            <div className="mt-3 rounded-[5px] border border-rojo/35 bg-rojo/8 p-2.5">
              <div className="rotulo mb-1">La cabecera que lo bloquea</div>
              <code className="dato block break-all text-[12px] text-texto">
                {diagnostico.cabecera}: {diagnostico.valor}
              </code>
            </div>

            <div className="mt-3">
              <div className="rotulo mb-1.5">Qué tenés que cambiar en el servidor de Chatwoot</div>
              <ol className="space-y-1.5">
                {diagnostico.comoArreglarlo.map((paso, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-texto-2">
                    <span className="dato shrink-0 text-texto-2/60">{i + 1}.</span>
                    <span className={paso.includes('add_header') || paso.includes('header {') ? 'dato text-texto' : ''}>
                      {paso}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-1.5">
          <Button asChild variant="primaria">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden />
              Abrir Chatwoot en una pestaña
            </a>
          </Button>
          <Button variant="secundaria" onClick={onReintentar}>
            <RefreshCw aria-hidden />
            Reintentar
          </Button>
        </div>

        <p className="mt-4 border-t border-borde pt-3 text-[11.5px] leading-relaxed text-texto-2">
          Mientras tanto podés trabajar en la pestaña aparte: el webhook sigue funcionando igual, así
          que las respuestas se registran en la consola aunque contestes desde ahí.
        </p>
      </div>
    </div>
  )
}

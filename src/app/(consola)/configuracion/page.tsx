import type { Metadata } from 'next'

import { Panel } from '@/components/ui/panel'
import { listarCuentas } from '@/server/accounts'
import { leerConfigVisible } from '@/server/chatwoot/config'
import { leerConfigEvolutionVisible } from '@/server/evolution/config'

import { PanelConfiguracion } from './panel'

export const metadata: Metadata = { title: 'Configuración · Consola' }
export const dynamic = 'force-dynamic'

export default async function PaginaConfiguracion() {
  const [chatwoot, evolution, cuentas] = await Promise.all([
    leerConfigVisible(),
    leerConfigEvolutionVisible(),
    listarCuentas(),
  ])

  const listo = chatwoot?.configurada || evolution !== null

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[20px]">Configuración</h1>
        <p className="mt-0.5 max-w-2xl text-[12.5px] leading-relaxed text-texto-2">
          Acá se conecta la consola con el servidor que manda los mensajes. Hasta que esto esté
          cargado, el Despachador abre WhatsApp y vos confirmás; una vez conectado, manda solo.
        </p>
      </div>

      {!listo ? (
        <Panel className="border-ambar/35 bg-ambar/8 px-3 py-2">
          <p className="text-[12.5px] text-texto">
            Todavía no hay ningún servidor de mensajería conectado.
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-texto-2">
            Ningún software puede mandar un WhatsApp por su cuenta: hace falta un servidor con tus
            números conectados. Tenés dos caminos, y con cualquiera de los dos el Despachador pasa a
            mandar de una.
          </p>
        </Panel>
      ) : null}

      <PanelConfiguracion
        chatwoot={
          chatwoot
            ? {
                baseUrl: chatwoot.baseUrl,
                accountId: chatwoot.accountId,
                tokenEnmascarado: chatwoot.tokenEnmascarado,
              }
            : null
        }
        evolution={
          evolution
            ? { baseUrl: evolution.baseUrl, apiKeyEnmascarada: evolution.apiKeyEnmascarada }
            : null
        }
        cuentas={cuentas}
      />

      {chatwoot ? (
        <Panel className="p-3">
          <div className="rotulo mb-1.5">Webhook de Chatwoot</div>
          <p className="text-[12px] leading-relaxed text-texto-2">
            Para que las respuestas entren solas, en Chatwoot andá a{' '}
            <span className="text-texto">Configuración → Integraciones → Webhooks</span> y agregá
            esta URL, con los eventos <span className="dato text-texto">message_created</span> y{' '}
            <span className="dato text-texto">conversation_status_changed</span>:
          </p>
          <code className="dato mt-1.5 block break-all rounded-[4px] border border-borde bg-fondo px-2 py-1.5 text-[11.5px] text-texto">
            {process.env.AUTH_URL ?? 'http://localhost:3000'}/api/webhooks/chatwoot?secreto=
            {chatwoot.webhookSecret}
          </code>
          <p className="mt-1.5 text-[11px] text-texto-2">
            Estado de la sincronización:{' '}
            <span
              className={
                chatwoot.sincronizacion.estado === 'verde'
                  ? 'text-verde'
                  : chatwoot.sincronizacion.estado === 'rojo'
                    ? 'text-rojo'
                    : 'text-ambar'
              }
            >
              {chatwoot.sincronizacion.motivo}
            </span>
          </p>
        </Panel>
      ) : null}

      <Panel className="p-3">
        <div className="rotulo mb-1.5">Por qué hacen falta estos datos</div>
        <p className="text-[12px] leading-relaxed text-texto-2">
          La consola decide <span className="text-texto">a quién</span> escribirle,{' '}
          <span className="text-texto">desde qué número</span> y{' '}
          <span className="text-texto">cuántos por día</span> — eso ya funciona. Lo que no puede
          hacer sola es la última parte: entregarle el mensaje a WhatsApp. Eso lo hace un servidor
          con tus números vinculados por QR, que es Evolution, con o sin Chatwoot adelante como
          bandeja.
        </p>
      </Panel>
    </div>
  )
}

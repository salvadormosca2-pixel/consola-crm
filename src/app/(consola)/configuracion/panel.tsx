'use client'

import * as React from 'react'

import type { FilaCuenta } from '@/server/accounts'

import { FormularioChatwoot, FormularioEvolution, MapeoDeCuentas } from './formularios'

type Item = { id: string; label: string; detalle: string; conectada: boolean }

/**
 * Junta los tres bloques de configuración.
 *
 * El estado vive acá porque la lista de inboxes que trae "probar conexión"
 * tiene que llegar al mapeo de cuentas, que está más abajo en la misma página.
 */
export function PanelConfiguracion({
  chatwoot,
  evolution,
  cuentas,
}: {
  chatwoot: { baseUrl: string; accountId: number; tokenEnmascarado: string } | null
  evolution: { baseUrl: string; apiKeyEnmascarada: string } | null
  cuentas: FilaCuenta[]
}) {
  const [inboxes, setInboxes] = React.useState<Item[]>([])
  const [instancias, setInstancias] = React.useState<Item[]>([])

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <FormularioChatwoot inicial={chatwoot} onInboxes={setInboxes} />
        <FormularioEvolution inicial={evolution} onInstancias={setInstancias} />
      </div>

      <MapeoDeCuentas cuentas={cuentas} inboxes={inboxes} instancias={instancias} />
    </div>
  )
}

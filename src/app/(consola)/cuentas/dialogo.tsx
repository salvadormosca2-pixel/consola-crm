'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import * as React from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Field, Input, Label, Textarea } from '@/components/ui/input'
import { ACCOUNT_MODES, ACCOUNT_STATUS_META, type AccountStatus } from '@/db/enums'
import { CHECKLIST_PREPARACION } from '@/server/rotation/quota'
import type { FilaCuenta } from '@/server/accounts'
import { guardarCuenta } from '@/server/actions/accounts'
import { ESTADO_INICIAL } from '@/lib/form-state'
import { cn } from '@/lib/utils'

export function DialogoCuenta({
  abierto,
  onCerrar,
  cuenta,
}: {
  abierto: boolean
  onCerrar: () => void
  cuenta: FilaCuenta | null
}) {
  const [estado, action] = React.useActionState(guardarCuenta, ESTADO_INICIAL)
  const [canal, setCanal] = React.useState<'whatsapp' | 'instagram'>(cuenta?.channel ?? 'whatsapp')
  const [estadoCuenta, setEstadoCuenta] = React.useState<AccountStatus>(
    cuenta?.status ?? 'esperando_preparacion',
  )
  const [checklist, setChecklist] = React.useState<Set<string>>(new Set())
  const cerradoRef = React.useRef(false)

  // Sincroniza el formulario cuando cambia la cuenta que se está editando.
  React.useEffect(() => {
    if (abierto) {
      setCanal(cuenta?.channel ?? 'whatsapp')
      setEstadoCuenta(cuenta?.status ?? 'esperando_preparacion')
      setChecklist(new Set(cuenta?.prepChecklist ?? []))
      cerradoRef.current = false
    }
  }, [abierto, cuenta])

  React.useEffect(() => {
    if (estado.ok && abierto && !cerradoRef.current) {
      cerradoRef.current = true
      toast.success(cuenta ? 'Cuenta actualizada' : 'Cuenta agregada')
      onCerrar()
    }
  }, [estado.ok, abierto, cuenta, onCerrar])

  const err = estado.campos

  return (
    <Dialog.Root open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[#0b0f14]/70" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 max-h-[92dvh] w-[min(560px,calc(100vw-1.5rem))]',
            '-translate-x-1/2 -translate-y-1/2 overflow-y-auto',
            'rounded-[6px] border border-borde bg-superficie',
          )}
        >
          <div className="flex items-center justify-between border-b border-borde px-3 py-2">
            <Dialog.Title className="text-[14px]">
              {cuenta ? `Editar ${cuenta.code}` : 'Agregar cuenta'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="fantasma" size="iconoSm" aria-label="Cerrar">
                <X aria-hidden />
              </Button>
            </Dialog.Close>
          </div>

          <Dialog.Description className="px-3 pt-2.5 text-[11.5px] text-texto-2">
            {canal === 'whatsapp'
              ? 'Un número de WhatsApp desde el que salen mensajes. El cupo limita cuántos por día.'
              : 'Un usuario de Instagram desde el que salen mensajes directos.'}
          </Dialog.Description>

          <form action={action} className="space-y-3 p-3">
            {cuenta ? <input type="hidden" name="id" value={cuenta.id} /> : null}

            <div>
              <Label>Canal</Label>
              <div className="flex gap-1.5">
                {(['whatsapp', 'instagram'] as const).map((c) => (
                  <label
                    key={c}
                    className={cn(
                      'flex h-7.5 flex-1 cursor-pointer items-center justify-center rounded-[4px] border text-[12px] font-medium',
                      'transition-colors duration-150',
                      canal === c
                        ? 'border-ambar/50 bg-ambar/12 text-ambar'
                        : 'border-borde bg-fondo text-texto-2 hover:border-[#42525f]',
                    )}
                  >
                    <input
                      type="radio"
                      name="channel"
                      value={c}
                      checked={canal === c}
                      onChange={() => setCanal(c)}
                      className="sr-only"
                    />
                    {c === 'whatsapp' ? 'WhatsApp' : 'Instagram'}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-[110px_1fr] gap-2">
              <Field label="Código" error={err.code} hint={err.code ? undefined : 'Ej: WA-01'}>
                <Input
                  name="code"
                  defaultValue={cuenta?.code ?? ''}
                  placeholder="WA-01"
                  required
                  aria-invalid={Boolean(err.code)}
                  className="dato uppercase"
                />
              </Field>
              <Field
                label="Nombre"
                error={err.label}
                hint={err.label ? undefined : 'Como lo reconocés vos'}
              >
                <Input
                  name="label"
                  defaultValue={cuenta?.label ?? ''}
                  placeholder={canal === 'whatsapp' ? 'WA-01 Ventas' : 'IG @minegocio'}
                  required
                  aria-invalid={Boolean(err.label)}
                />
              </Field>
            </div>

            {canal === 'whatsapp' ? (
              <Field
                label="Número"
                error={err.phone}
                hint={err.phone ? undefined : 'Formato internacional, sin espacios ni signos: 5493834567890'}
              >
                <Input
                  name="phone"
                  defaultValue={cuenta?.phoneE164 ?? ''}
                  placeholder="5493834567890"
                  inputMode="numeric"
                  aria-invalid={Boolean(err.phone)}
                  className="dato"
                />
              </Field>
            ) : (
              <Field
                label="Usuario de Instagram"
                error={err.igUsername}
                hint={err.igUsername ? undefined : 'Sin @. Podés pegar la URL y se limpia sola.'}
              >
                <Input
                  name="igUsername"
                  defaultValue={cuenta?.igUsername ?? ''}
                  placeholder="minegocio"
                  aria-invalid={Boolean(err.igUsername)}
                  className="dato"
                />
              </Field>
            )}
            {/* El campo del otro canal viaja vacío para que el esquema lo valide igual. */}
            <input type="hidden" name={canal === 'whatsapp' ? 'igUsername' : 'phone'} value="" />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Estado</Label>
                <select
                  name="status"
                  value={estadoCuenta}
                  onChange={(e) => setEstadoCuenta(e.target.value as AccountStatus)}
                  className="h-7.5 w-full rounded-[4px] border border-borde bg-fondo px-2 text-[12.5px] text-texto focus:border-ambar focus:outline-none"
                >
                  {(Object.keys(ACCOUNT_STATUS_META) as AccountStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {ACCOUNT_STATUS_META[s].label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Modo de envío</Label>
                <select
                  name="mode"
                  defaultValue={cuenta?.mode ?? 'manual'}
                  className="h-7.5 w-full rounded-[4px] border border-borde bg-fondo px-2 text-[12.5px] text-texto focus:border-ambar focus:outline-none"
                >
                  {ACCOUNT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m === 'manual' ? 'Manual (abro el chat)' : 'API (envía Evolution)'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field
                label="Cupo diario"
                error={err.dailyCap}
                hint={
                  err.dailyCap
                    ? undefined
                    : estadoCuenta === 'calentando'
                      ? 'Mientras calienta manda lo que diga la escala, no esto'
                      : 'Mensajes por día'
                }
              >
                <Input
                  name="dailyCap"
                  type="number"
                  min={0}
                  max={500}
                  defaultValue={cuenta?.dailyCap ?? 30}
                  required
                  aria-invalid={Boolean(err.dailyCap)}
                  className="dato"
                />
              </Field>
              <Field
                label="Pausa mínima"
                error={err.minGapSeconds}
                hint={err.minGapSeconds ? undefined : 'Segundos. El piso global son 4 min.'}
              >
                <Input
                  name="minGapSeconds"
                  type="number"
                  min={0}
                  max={3600}
                  defaultValue={cuenta?.minGapSeconds ?? 240}
                  required
                  aria-invalid={Boolean(err.minGapSeconds)}
                  className="dato"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Abre a las" error={err.windowStart}>
                <Input
                  name="windowStart"
                  type="time"
                  defaultValue={(cuenta?.windowStart ?? '09:00').slice(0, 5)}
                  required
                  aria-invalid={Boolean(err.windowStart)}
                  className="dato"
                />
              </Field>
              <Field label="Cierra a las" error={err.windowEnd}>
                <Input
                  name="windowEnd"
                  type="time"
                  defaultValue={(cuenta?.windowEnd ?? '20:00').slice(0, 5)}
                  required
                  aria-invalid={Boolean(err.windowEnd)}
                  className="dato"
                />
              </Field>
            </div>

            {canal === 'whatsapp' ? (
              <Field
                label="Instancia de Evolution"
                error={err.instanceName}
                hint={err.instanceName ? undefined : 'Solo si el modo es API.'}
              >
                <Input
                  name="instanceName"
                  defaultValue={cuenta?.instanceName ?? ''}
                  placeholder="instancia-wa-01"
                  aria-invalid={Boolean(err.instanceName)}
                  className="dato"
                />
              </Field>
            ) : (
              <Field
                label="Sesión del navegador"
                error={err.sessionHint}
                hint={
                  err.sessionHint
                    ? undefined
                    : 'Dónde tenés que estar logueado para usarla. Aparece arriba del bloque.'
                }
              >
                <Input
                  name="sessionHint"
                  defaultValue={cuenta?.sessionHint ?? ''}
                  placeholder="Chrome perfil 3"
                  aria-invalid={Boolean(err.sessionHint)}
                />
              </Field>
            )}
            {/* El campo del otro canal viaja vacío para que el esquema valide igual. */}
            <input
              type="hidden"
              name={canal === 'whatsapp' ? 'sessionHint' : 'instanceName'}
              value=""
            />

            <ChecklistPreparacion
              marcados={checklist}
              onCambiar={setChecklist}
              error={err.prepChecklist}
              exigido={estadoCuenta === 'activa' || estadoCuenta === 'calentando'}
            />
            <input type="hidden" name="prepChecklist" value={[...checklist].join(',')} />

            <Field label="Notas" error={err.notes}>
              <Textarea name="notes" rows={2} defaultValue={cuenta?.notes ?? ''} />
            </Field>

            {estado.error ? (
              <p
                role="alert"
                className="rounded-[4px] border border-rojo/35 bg-rojo/10 px-2 py-1.5 text-[11.5px] text-rojo"
              >
                {estado.error}
              </p>
            ) : null}

            <div className="flex justify-end gap-1.5 border-t border-borde pt-3">
              <Dialog.Close asChild>
                <Button type="button" variant="fantasma">
                  Cancelar
                </Button>
              </Dialog.Close>
              <BotonGuardar edicion={cuenta !== null} />
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * Lo que el software no puede verificar y confirma la persona. Sin esto
 * completo, la cuenta no entra al reparto: mandar poco no es calentar, lo que
 * sostiene un número es el perfil y el tráfico real.
 */
function ChecklistPreparacion({
  marcados,
  onCambiar,
  error,
  exigido,
}: {
  marcados: Set<string>
  onCambiar: (s: Set<string>) => void
  error?: string
  exigido: boolean
}) {
  const faltan = CHECKLIST_PREPARACION.filter((i) => !marcados.has(i.key)).length

  return (
    <div
      className={cn(
        'rounded-[5px] border p-2.5',
        error ? 'border-rojo/50 bg-rojo/5' : 'border-borde bg-fondo',
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="rotulo">Preparación del número</span>
        <span className={cn('dato text-[10.5px]', faltan === 0 ? 'text-verde' : 'text-texto-2')}>
          {CHECKLIST_PREPARACION.length - faltan}/{CHECKLIST_PREPARACION.length}
        </span>
      </div>

      <div className="space-y-1.5">
        {CHECKLIST_PREPARACION.map((item) => (
          <label key={item.key} className="flex cursor-pointer items-start gap-2 text-[11.5px] leading-snug">
            <input
              type="checkbox"
              checked={marcados.has(item.key)}
              onChange={(e) => {
                const s = new Set(marcados)
                if (e.target.checked) s.add(item.key)
                else s.delete(item.key)
                onCambiar(s)
              }}
              className="mt-0.5 h-3 w-3 shrink-0 accent-[#e8a33d]"
            />
            <span className={marcados.has(item.key) ? 'text-texto' : 'text-texto-2'}>{item.label}</span>
          </label>
        ))}
      </div>

      {error ? (
        <p className="mt-2 text-[11px] text-rojo">{error}</p>
      ) : faltan > 0 && exigido ? (
        <p className="mt-2 text-[11px] text-ambar">
          Con puntos sin marcar, la cuenta no puede quedar activa ni calentando.
        </p>
      ) : null}
    </div>
  )
}

function BotonGuardar({ edicion }: { edicion: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="primaria" disabled={pending}>
      {pending ? 'Guardando…' : edicion ? 'Guardar cambios' : 'Agregar cuenta'}
    </Button>
  )
}

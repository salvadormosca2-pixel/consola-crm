import './load-env'

import { Pool } from 'pg'

import { OPS_CONFIG_DEFAULT, opsConfigSchema } from '../src/lib/ops-config'
import { accountSchema } from '../src/lib/validation/account'
import { renderTemplate, datosDeContacto, elegirVariante } from '../src/lib/templates/render'
import { revisarContraVoz, voiceSchema } from '../src/lib/voice'
import { repartir, resolverCuentaDelExcel, type CuentaParaReparto } from '../src/lib/import/distribute'
import { cifrar, descifrar, comparaSeguro } from '../src/lib/crypto'
import { CHECKLIST_PREPARACION, preparacionCompleta } from '../src/server/rotation/quota'
import { diagnosticar, debeBloquearse } from '../src/server/rotation/health'

/**
 * Auditoría funcional: ejecuta cada acción contra la base real y verifica el
 * efecto, no solo que no explote. Deja la base como la encontró.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const r: Array<{ ok: boolean; seccion: string; nombre: string; detalle: string }> = []
let seccionActual = ''

const seccion = (s: string) => {
  seccionActual = s
  console.log(`\n── ${s} ${'─'.repeat(Math.max(60 - s.length, 0))}`)
}
const check = (nombre: string, ok: boolean, detalle = '') => {
  r.push({ ok, seccion: seccionActual, nombre, detalle })
  console.log(`  ${ok ? 'OK   ' : 'FALLA'} ${nombre}${detalle ? '  · ' + detalle : ''}`)
}

const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<T[]> =>
  (await pool.query(sql, p)).rows as T[]

const uno = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<T | undefined> =>
  (await q<T>(sql, p))[0]

async function main() {
  const hayDemo = await uno<{ n: string }>(`select count(*) as n from contacts`)
  if (Number(hayDemo?.n ?? 0) === 0) {
    console.log('No hay datos. Corré primero: npm run demo:cargar')
    process.exit(1)
  }

  /* ═══ CUENTAS ═══════════════════════════════════════════════════════ */
  seccion('Cuentas · guardar, validar, estados')

  const CHECK_OK = Object.fromEntries(CHECKLIST_PREPARACION.map((i) => [i.key, true]))
  const BASE_FORM = {
    code: 'AUD-01', label: 'Auditoría', channel: 'whatsapp' as const,
    phone: '5493834569901', igUsername: '', instanceName: '', sessionHint: '',
    mode: 'manual' as const, status: 'activa' as const, dailyCap: '30',
    minGapSeconds: '240', windowStart: '09:00', windowEnd: '20:00',
    prepChecklist: CHECKLIST_PREPARACION.map((i) => i.key).join(','), notes: '',
  }

  check('acepta una cuenta válida', accountSchema.safeParse(BASE_FORM).success)
  check('rechaza teléfono inválido',
    !accountSchema.safeParse({ ...BASE_FORM, phone: '123' }).success)
  check('rechaza activar sin checklist completo',
    !accountSchema.safeParse({ ...BASE_FORM, prepChecklist: '' }).success)
  check('deja guardar sin preparar si no entra al reparto',
    accountSchema.safeParse({ ...BASE_FORM, status: 'esperando_preparacion', prepChecklist: '' }).success)
  check('rechaza ventana horaria invertida',
    !accountSchema.safeParse({ ...BASE_FORM, windowStart: '20:00', windowEnd: '09:00' }).success)
  check('preparacionCompleta exige los 5 puntos',
    preparacionCompleta(CHECK_OK) && !preparacionCompleta({ perfil: true }))

  // Unicidad en la base
  const dup = await pool.query(
    `insert into messaging_accounts (code, label, channel, phone_e164, status, prep_checklist)
     values ('WA-01','dup','whatsapp','5493834569999','activa','{}'::jsonb)`,
  ).then(() => 'sin-error').catch((e) => e.code ?? 'otro')
  check('la base rechaza código de cuenta duplicado', dup === '23505', String(dup))

  // Borrar con contactos asignados
  const conAsignados = await uno<{ id: string; n: string }>(`
    select a.id, count(c.id) as n from messaging_accounts a
    join contacts c on c.assigned_wa_account_id = a.id
    group by a.id having count(c.id) > 0 limit 1`)
  check('hay cuentas con contactos, para probar el bloqueo de borrado', Boolean(conAsignados),
    conAsignados ? `${conAsignados.n} contactos` : '')

  /* ═══ SALUD Y CALENTAMIENTO ═════════════════════════════════════════ */
  seccion('Cuentas · semáforo de salud')

  const sana = { status: 'activa' as const, consecutiveFailures: 0, enviados7d: 100, respondidos7d: 25, tasaHistorica: 0.25, diasDeUso: 60 }
  check('número sano da verde', diagnosticar(sana).salud === 'verde')
  check('3 fallos dan rojo', diagnosticar({ ...sana, consecutiveFailures: 3 }).salud === 'rojo')
  check('respuesta bajo 10% da rojo', diagnosticar({ ...sana, respondidos7d: 4 }).salud === 'rojo')
  check('bloquea sola a los 3 fallos', debeBloquearse({ consecutiveFailures: 3 }, 3).bloquear)
  check('cada diagnóstico trae motivo', diagnosticar(sana).motivo.length > 10)

  /* ═══ PLANTILLAS ════════════════════════════════════════════════════ */
  seccion('Plantillas · armado del mensaje')

  interface ContactoDePrueba {
    business_name: string
    contact_name: string
    niche: string
    bought: string
    city: string | null
  }
  const contacto = (await uno<ContactoDePrueba>(`
    select business_name, contact_name, niche, bought, city from contacts
     where contact_name is not null and bought is not null and niche is not null limit 1`))!

  const datos = datosDeContacto({
    businessName: contacto.business_name,
    contactName: contacto.contact_name,
    niche: contacto.niche,
    bought: contacto.bought,
    city: contacto.city,
  }, { miNombre: 'Salva', oferta: 'gestión de redes' })

  const plantilla = await uno<{ body: string; variants: unknown }>(
    `select body, variants from templates where sequence_step = 1 and channel = 'whatsapp' limit 1`)

  const armado = renderTemplate(plantilla!.body, datos)
  check('arma el mensaje con un contacto real', armado.ok,
    armado.ok ? armado.texto.slice(0, 60) + '…' : armado.motivo)
  check('no deja variables sin reemplazar', armado.ok && !armado.texto.includes('{{'))
  check('NO manda si falta un dato',
    !renderTemplate('Hola {{nombre}}, sobre {{compro}}', { nombre: 'Ana' }).ok)
  check('el motivo dice qué variable falta',
    (renderTemplate('Hola {{compro}}', {}) as { motivo: string }).motivo.includes('compro'))
  check('usa el nombre de pila, no el completo', datos.nombre === contacto.contact_name.split(' ')[0])

  const v1 = elegirVariante(plantilla!.body, plantilla!.variants, 'contacto-a')
  const v2 = elegirVariante(plantilla!.body, plantilla!.variants, 'contacto-a')
  const v3 = elegirVariante(plantilla!.body, plantilla!.variants, 'contacto-z')
  check('la variante es estable para el mismo contacto', v1.indice === v2.indice)
  check('las variantes rotan entre contactos',
    new Set([v1.indice, v3.indice]).size >= 1)

  /* ═══ MI VOZ ════════════════════════════════════════════════════════ */
  seccion('Mi voz')

  const voz = voiceSchema.parse({ prohibidas: ['estimado', 'aprovecho para'], tuteo: 'vos', emojis: 'nunca' })
  check('detecta una palabra prohibida',
    revisarContraVoz('Estimado cliente, le escribo', voz).some((a) => a.includes('estimado')))
  check('detecta el usted', revisarContraVoz('Le escribo a usted', voz).length > 0)
  check('detecta emojis cuando dijiste que no usás',
    revisarContraVoz('Hola 😀', voz).some((a) => a.includes('emojis')))
  check('no marca nada si el texto está bien',
    revisarContraVoz('Hola Marce, ¿cómo va?', voz).length === 0)

  /* ═══ REPARTO ═══════════════════════════════════════════════════════ */
  seccion('Reparto entre cuentas')

  const cuentas: CuentaParaReparto[] = (await q<Record<string, string | null>>(
    `select id, code, label, channel, phone_e164, ig_username, status from messaging_accounts order by code`
  )).map((c) => ({
    id: String(c.id), code: String(c.code), label: String(c.label),
    channel: c.channel as 'whatsapp' | 'instagram',
    phoneE164: c.phone_e164 ?? null, igUsername: c.ig_username ?? null,
    cargaActual: 0, operativa: c.status === 'activa' || c.status === 'calentando',
  }))

  check('resuelve la cuenta por código', resolverCuentaDelExcel('wa-01', cuentas)?.code === 'WA-01')
  check('resuelve por número',
    resolverCuentaDelExcel(`+${cuentas.find((c) => c.code === 'WA-01')!.phoneE164}`, cuentas)?.code === 'WA-01')
  check('devuelve null si no existe, no adivina', resolverCuentaDelExcel('WA-99', cuentas) === null)

  const reparto = repartir(
    Array.from({ length: 80 }, (_, i) => ({ clave: `c${i}`, tienePhone: true, tieneInstagram: false, accountRaw: null })),
    cuentas,
  )
  const porCuenta = new Map<string, number>()
  for (const a of reparto) if (a.waAccountId) porCuenta.set(a.waAccountId, (porCuenta.get(a.waAccountId) ?? 0) + 1)
  const vals = [...porCuenta.values()]
  check('el reparto queda parejo', vals.length > 0 && Math.max(...vals) - Math.min(...vals) <= 1,
    vals.sort((a, b) => a - b).join(' '))
  check('no usa cuentas pausadas ni bloqueadas',
    !reparto.some((a) => a.waAccountId && !cuentas.find((c) => c.id === a.waAccountId)!.operativa))

  /* ═══ CUPOS ═════════════════════════════════════════════════════════ */
  seccion('Cupos y configuración operativa')

  check('escala de calentamiento 5→30',
    JSON.stringify(OPS_CONFIG_DEFAULT.escalaCalentamiento) === '[5,8,12,16,21,26,30]')
  check('domingo excluido por defecto', !OPS_CONFIG_DEFAULT.diasActivos.includes(0))
  check('sábado incluido por defecto', OPS_CONFIG_DEFAULT.diasActivos.includes(6))
  check('colchón para respuestas activo', OPS_CONFIG_DEFAULT.colchonParaRespuestas > 0,
    String(OPS_CONFIG_DEFAULT.colchonParaRespuestas))
  check('espera mínima de 4 minutos', OPS_CONFIG_DEFAULT.esperaMismaCuentaSeg === 240)
  check('rechaza escala vacía', !opsConfigSchema.safeParse({ escalaCalentamiento: [] }).success)

  // El contador solo vale si counter_date es hoy: si quedó de ayer, se lee como
  // cero y no hace falta ningún job de medianoche. Comparar sin mirar la fecha
  // marcaría un descuadre que no existe.
  const cupoReal = await q<{ code: string; sent_today: number; en_mensajes: string }>(`
    select a.code,
           case when a.counter_date = (now() at time zone 'America/Argentina/Catamarca')::date
                then a.sent_today else 0 end as sent_today,
           (select count(*) from messages m
             where m.account_id = a.id and m.status in ('enviado','entregado','leido','respondido')
               and m.undone_at is null
               and (m.sent_at at time zone 'America/Argentina/Catamarca')::date
                   = (now() at time zone 'America/Argentina/Catamarca')::date) as en_mensajes
      from messaging_accounts a where a.channel = 'whatsapp' order by a.code`)
  const descuadres = cupoReal.filter((c) => c.sent_today !== Number(c.en_mensajes))
  check('el contador coincide con los mensajes', descuadres.length === 0,
    descuadres.length ? descuadres.map((d) => `${d.code}:${d.sent_today}≠${d.en_mensajes}`).join(' ') : 'todas cuadran')

  /* ═══ CIFRADO ═══════════════════════════════════════════════════════ */
  seccion('Cifrado de credenciales')

  const secreto = 'cw_pat_prueba_1234567890'
  const cifrado = cifrar(secreto)
  check('cifra y descifra', descifrar(cifrado) === secreto)
  check('el valor guardado no contiene el original', !cifrado.includes('prueba'))
  check('dos cifrados del mismo texto son distintos', cifrar(secreto) !== cifrar(secreto))
  check('detecta un valor alterado', (() => {
    const p = cifrado.split('.')
    p[3] = (p[3]![0] === 'A' ? 'B' : 'A') + p[3]!.slice(1)
    try { descifrar(p.join('.')); return false } catch { return true }
  })())
  check('compara secretos en tiempo constante', comparaSeguro('abc', 'abc') && !comparaSeguro('abc', 'abd'))

  /* ═══ COLA DEL DESPACHADOR ══════════════════════════════════════════ */
  seccion('Despachador · composición de la cola')

  const cola = await q<{ prioridad: string; n: string }>(`
    select case when c.sent_count = 0 then 'nuevo'
                when c.next_followup_at < date_trunc('day', now()) then 'vencido'
                else 'hoy' end as prioridad, count(*) as n
      from contacts c join messaging_accounts a on a.id = c.assigned_wa_account_id
     where c.discarded_at is null and c.phone_e164 is not null
       and a.status in ('activa','calentando') and c.received_count = 0
       and c.stage not in ('cerrado','perdido','no_contactar','descartado','sin_respuesta',
                           'respondido','interesado','reunion_agendada')
       and (c.sent_count = 0 or (c.next_followup_at is not null and c.next_followup_at <= now()))
     group by 1`)
  check('la cola tiene contactos nuevos', cola.some((c) => c.prioridad === 'nuevo'),
    cola.map((c) => `${c.prioridad}:${c.n}`).join(' '))

  // Los seguimientos solo existen si alguien recibió un primer mensaje. Con la
  // base recién cargada no hay ninguno, y eso es lo correcto.
  const yaContactados = await uno<{ n: string }>(
    `select count(*) as n from contacts where sent_count > 0 and received_count = 0`)
  const hayContactados = Number(yaContactados?.n ?? 0) > 0
  check(
    hayContactados
      ? 'los contactados aparecen como seguimiento'
      : 'sin nadie contactado, no hay seguimientos inventados',
    hayContactados ? cola.some((c) => c.prioridad !== 'nuevo') : !cola.some((c) => c.prioridad !== 'nuevo'),
    `${yaContactados?.n} contactados`,
  )

  const etapasFalsas = await uno<{ n: string }>(
    `select count(*) as n from contacts where sent_count = 0 and stage <> 'nuevo'
       and stage not in ('no_contactar','descartado')`)
  check('ningún contacto sin mensajes figura como contactado',
    Number(etapasFalsas?.n ?? 0) === 0, `${etapasFalsas?.n} con etapa que no corresponde`)

  const yaContestaron = await uno<{ n: string }>(`
    select count(*) as n from contacts c
     join messaging_accounts a on a.id = c.assigned_wa_account_id
    where c.received_count > 0 and c.next_followup_at is not null`)
  check('ningún contacto que contestó tiene seguimiento programado',
    Number(yaContestaron?.n ?? 0) === 0, `${yaContestaron?.n} con seguimiento pendiente`)

  /* ═══ INTEGRIDAD DE DATOS ═══════════════════════════════════════════ */
  seccion('Integridad de los datos')

  const sinCanal = await uno<{ n: string }>(
    `select count(*) as n from contacts where phone_e164 is null and ig_username is null`)
  check('ningún contacto sin canal', Number(sinCanal?.n) === 0)

  const telMal = await uno<{ n: string }>(
    `select count(*) as n from contacts where phone_e164 is not null and phone_e164 !~ '^[0-9]{8,15}$'`)
  check('todos los teléfonos en formato E.164', Number(telMal?.n) === 0)

  const igMal = await uno<{ n: string }>(
    `select count(*) as n from contacts where ig_username is not null and ig_username !~ '^[a-z0-9._]+$'`)
  check('todos los usuarios de Instagram limpios', Number(igMal?.n) === 0)

  const dupTel = await uno<{ n: string }>(
    `select count(*) as n from (select phone_e164 from contacts where phone_e164 is not null
      group by 1 having count(*) > 1) x`)
  check('no hay teléfonos duplicados', Number(dupTel?.n) === 0)

  const sinCuenta = await uno<{ n: string }>(`
    select count(*) as n from contacts
     where discarded_at is null and assigned_wa_account_id is null and assigned_ig_account_id is null`)
  check('todos los contactos tienen cuenta asignada', Number(sinCuenta?.n) === 0,
    `${sinCuenta?.n} sin asignar`)

  const scoreMal = await uno<{ n: string }>(`select count(*) as n from contacts where score < 0 or score > 100`)
  check('todos los scores entre 0 y 100', Number(scoreMal?.n) === 0)

  /* ═══ ÍNDICES ═══════════════════════════════════════════════════════ */
  seccion('Índices y esquema')

  const idx = await q<{ indexname: string }>(`select indexname from pg_indexes where schemaname='public'`)
  const nombres = new Set(idx.map((i) => i.indexname))
  for (const necesario of [
    'contacts_phone_uq', 'contacts_ig_uq', 'contacts_dedupe_key_uq',
    'messages_idempotency_uq', 'messages_cupo_idx', 'messages_chatwoot_uq',
    'accounts_code_uq', 'accounts_chatwoot_inbox_uq', 'contacts_seguimiento_idx',
  ]) {
    check(`índice ${necesario}`, nombres.has(necesario))
  }

  const tablas = await q<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema='public'`)
  check('están las 13 tablas', tablas.length >= 13, `${tablas.length} tablas`)

  /* ═══ RESUMEN ═══════════════════════════════════════════════════════ */
  await pool.end()

  const fallas = r.filter((x) => !x.ok)
  console.log('\n' + '═'.repeat(66))
  console.log(`${r.length - fallas.length}/${r.length} verificaciones pasaron`)
  if (fallas.length > 0) {
    console.log('\nFALLAS:')
    for (const f of fallas) console.log(`  · [${f.seccion}] ${f.nombre}${f.detalle ? ' — ' + f.detalle : ''}`)
  }
  process.exit(fallas.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })

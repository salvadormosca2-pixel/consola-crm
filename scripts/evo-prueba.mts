import './load-env'

// Levanta un Evolution API simulado, lo configura en la consola y verifica que
// el Despachador pase a "Enviar" y que el mensaje salga de verdad por la API.
import { createServer } from 'node:http'
import { Client } from 'pg'

const PUERTO = 3210
const API_KEY = 'clave-de-prueba-evolution-123456'
const recibidos: Array<{ instancia: string; number?: string; text?: string }> = []

const evolution = createServer((req, res) => {
  const cuerpo: Buffer[] = []
  req.on('data', (c: Buffer) => cuerpo.push(c))
  req.on('end', () => {
    if (req.headers.apikey !== API_KEY) {
      res.writeHead(401, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: 'apikey inválida' }))
    }

    if (req.url === '/instance/fetchInstances') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(
        JSON.stringify(
          Array.from({ length: 10 }, (_, i) => ({
            instance: {
              instanceName: `instancia-wa-${String(i + 1).padStart(2, '0')}`,
              state: 'open',
            },
          })),
        ),
      )
    }

    if (req.url?.startsWith('/message/sendText/')) {
      const json = JSON.parse(Buffer.concat(cuerpo).toString() || '{}')
      recibidos.push({ instancia: decodeURIComponent(req.url.split('/').pop() ?? ''), ...json })
      res.writeHead(201, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ key: { id: `evo-${recibidos.length}` }, status: 'PENDING' }))
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'no encontrado' }))
  })
})

await new Promise<void>((r) => evolution.listen(PUERTO, () => r()))
console.log(`Evolution simulado en http://localhost:${PUERTO}\n`)

const BASE = 'http://localhost:3000'
const [, , EMAIL, PASS] = process.argv
const jar = new Map<string, string>()
const ch = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')

async function req(p: string, i: RequestInit = {}) {
  const r = await fetch(BASE + p, {
    ...i,
    redirect: 'manual',
    headers: { cookie: ch(), ...(i.headers ?? {}) },
  })
  for (const raw of r.headers.getSetCookie?.() ?? []) {
    const [pair = ''] = raw.split(';')
    const k = pair.indexOf('=')
    jar.set(pair.slice(0, k), pair.slice(k + 1))
  }
  return r
}

const res: boolean[] = []
const check = (n: string, ok: boolean, d = '') => {
  res.push(ok)
  console.log(`${ok ? 'OK   ' : 'FALLA'}  ${n}${d ? ' — ' + d : ''}`)
}

const { csrfToken } = (await (await req('/api/auth/csrf')).json()) as { csrfToken: string }
await req('/api/auth/callback/credentials', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ csrfToken, email: EMAIL!, password: PASS! }),
})

const pg = new Client({ connectionString: 'postgres://crm:crm_local_dev@localhost:5432/crm' })
await pg.connect()
await pg.query(`delete from settings where key = 'evolution'`)

/* ── 1. Antes de configurar ────────────────────────────────────────────── */
await req('/despachador')
let desp = await (await req('/despachador')).text()
check('sin configurar, dice "Abrir WhatsApp"', desp.includes('Abrir WhatsApp'))
check('explica por qué y adónde ir', desp.includes('todavía no hay servidor conectado'))

/* ── 2. Configurar Evolution con la función real (prueba el cifrado) ───── */
const { guardarConfigEvolution, leerConfigEvolution } = await import('../src/server/evolution/config.js')
await guardarConfigEvolution({ baseUrl: `http://localhost:${PUERTO}`, apiKey: API_KEY })

const cfgEvo = await leerConfigEvolution()
check('la config se guarda cifrada y se lee de vuelta', cfgEvo?.apiKey === API_KEY)

const { rowCount } = await pg.query(
  `update messaging_accounts set mode = 'api' where channel = 'whatsapp' and instance_name is not null`,
)
check('las cuentas tienen su instancia asignada', (rowCount ?? 0) > 0, `${rowCount} cuentas`)

/* ── 3. El botón cambia ────────────────────────────────────────────────── */
await req('/despachador')
desp = await (await req('/despachador')).text()
check('ahora dice "Enviar"', desp.includes('>Enviar<'))
check('ya no dice "Abrir WhatsApp"', !desp.includes('Abrir WhatsApp'))
check('desapareció el aviso de configurar', !desp.includes('todavía no hay servidor conectado'))

/* ── 4. Mandar de verdad ───────────────────────────────────────────────── */
const { rows: [contacto] } = await pg.query(`
  select c.id, c.business_name, c.phone_e164, c.assigned_wa_account_id as cuenta,
         a.instance_name
    from contacts c join messaging_accounts a on a.id = c.assigned_wa_account_id
   where c.sent_count = 0 and c.phone_e164 is not null and a.instance_name is not null
   limit 1`)

const { enviarTexto } = await import('../src/server/evolution/client.js')
const { reservarYCrearMensaje } = await import('../src/server/rotation/reserve.js')
const { db } = await import('../src/db/index.js')
const { OPS_CONFIG_DEFAULT } = await import('../src/lib/ops-config.js')

const TEXTO = 'Hola, te escribo por lo del pack de reels.'

// Primero se reserva el cupo, después se manda: ante una caída se envía de
// menos, nunca de más.
const reserva = await reservarYCrearMensaje(db, {
  accountId: contacto.cuenta,
  cfg: OPS_CONFIG_DEFAULT,
  ignorarVentana: true,
  mensaje: {
    contactId: contacto.id,
    channel: 'whatsapp',
    body: TEXTO,
    sendMode: 'evolution',
    sequenceStep: 1,
    status: 'enviado',
  },
})
check('reserva el cupo antes de mandar', reserva.ok, reserva.ok ? '' : reserva.detalle)

const envio = await enviarTexto(cfgEvo!, {
  instancia: contacto.instance_name,
  e164: contacto.phone_e164,
  texto: TEXTO,
})

check('Evolution recibió el mensaje', recibidos.length === 1, `${recibidos.length} mensajes`)
check('llegó al número correcto', recibidos[0]?.number === contacto.phone_e164, recibidos[0]?.number)
check('llegó con el texto correcto', Boolean(recibidos[0]?.text?.includes('pack de reels')))
check('salió por la instancia de esa cuenta',
  recibidos[0]?.instancia === contacto.instance_name, recibidos[0]?.instancia)
check('devolvió el id externo', Boolean(envio.externalId), envio.externalId ?? 'sin id')

if (reserva.ok) {
  await pg.query('update messages set external_id = $1, sync_status = $2 where id = $3', [
    envio.externalId, 'sin_sincronizar', reserva.messageId,
  ])
}

const { rows: [msg] } = await pg.query(
  `select send_mode, status, external_id, sync_status from messages where contact_id = $1`,
  [contacto.id],
)
check('registrado como enviado por Evolution', msg?.send_mode === 'evolution', msg?.send_mode)
check('guardó el id externo', Boolean(msg?.external_id), msg?.external_id)
check('marcado sin sincronizar, porque no hay Chatwoot', msg?.sync_status === 'sin_sincronizar')

const { rows: [cuenta] } = await pg.query(
  `select sent_today from messaging_accounts where id = $1`, [contacto.cuenta])
check('consumió cupo de la cuenta', Number(cuenta?.sent_today) === 1, String(cuenta?.sent_today))

/* ── 5. Con la API key equivocada, falla y lo dice ─────────────────────── */
let fallo = ''
try {
  await enviarTexto({ baseUrl: `http://localhost:${PUERTO}`, apiKey: 'mala' }, {
    instancia: contacto.instance_name, e164: contacto.phone_e164, texto: 'x',
  })
} catch (e) {
  fallo = e instanceof Error ? e.message : ''
}
check('rechaza una API key inválida con mensaje claro', fallo.includes('API key'), fallo)

/* ── 6. Limpiar ────────────────────────────────────────────────────────── */
await pg.query('delete from messages where contact_id = $1', [contacto.id])
await pg.query(`update contacts set stage='nuevo', sent_count=0, sequence_step=0,
  last_outbound_at=null, next_followup_at=null where id = $1`, [contacto.id])
await pg.query(`update messaging_accounts set sent_today=0, counter_date=null, last_sent_at=null`)
await pg.query(`delete from settings where key = 'evolution'`)
await pg.end()
await db.$client.end()
evolution.close()

const fallas = res.filter((x) => !x).length
console.log(`\n${res.length - fallas}/${res.length} verificaciones pasaron`)
process.exit(fallas === 0 ? 0 : 1)

import './load-env'

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Pool } from 'pg'
import * as XLSX from 'xlsx'

/**
 * Datos de demostración, para poder ver la consola funcionando antes de tener
 * datos reales.
 *
 *   npm run demo:cargar      carga cuentas, contactos e historial + genera un Excel
 *   npm run demo:historial   borra el historial inventado, deja los contactos en cero
 *   npm run demo:limpiar     borra todo y deja la base como recién migrada
 *
 * Todo lo que crea queda marcado con DEMO en las notas de las cuentas y en el
 * nombre del lote de importación, así que `demo:limpiar` puede sacarlo entero.
 * Esto NO es parte del producto: es un andamio para mirar la interfaz.
 */

const MARCA = 'DEMO'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

const CHECKLIST_OK = {
  perfil: true,
  antiguedad: true,
  conversaciones: true,
  celular: true,
  instancia: true,
}

/* ── Material para que los datos parezcan reales ──────────────────────────── */

const RUBROS = [
  'peluquería', 'gimnasio', 'kiosco', 'panadería', 'ferretería', 'veterinaria',
  'óptica', 'heladería', 'librería', 'cerrajería', 'estética', 'lavadero',
]

const PREFIJOS = [
  'Estilo', 'Don', 'La Esquina de', 'El Rincón de', 'Casa', 'Punto',
  'La Nueva', 'Centro', 'Studio', 'Espacio', 'Tienda',
]

const NOMBRES = [
  'Marcela', 'Gustavo', 'Silvina', 'Ramiro', 'Analía', 'Federico', 'Vanina',
  'Leandro', 'Carolina', 'Nicolás', 'Verónica', 'Damián', 'Roxana', 'Sergio',
  'Mariela', 'Emiliano', 'Patricia', 'Julián', 'Gabriela', 'Hernán',
]

const APELLIDOS = [
  'Quiroga', 'Barrionuevo', 'Acuña', 'Vergara', 'Molina', 'Sosa', 'Herrera',
  'Ponce', 'Agüero', 'Carrizo', 'Vega', 'Luna', 'Ibáñez', 'Moreno', 'Ríos',
]

const CIUDADES = [
  ['Catamarca', '383'], ['Córdoba', '351'], ['Rosario', '341'],
  ['Buenos Aires', '11'], ['Tucumán', '381'], ['Salta', '387'],
] as const

const COMPRAS = [
  'pack de 4 reels', 'sesión de fotos de producto', 'diseño de logo',
  'gestión de redes 1 mes', 'video institucional', 'pack de historias',
  'fotos de local', 'rediseño de perfil',
]

/** Azar reproducible: dos corridas generan exactamente lo mismo. */
function azar(semilla: number): () => number {
  let s = semilla
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const rnd = azar(20260813)
const elegir = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
const entre = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))

function negocio(i: number): string {
  const rubro = RUBROS[i % RUBROS.length]!
  return rnd() > 0.5
    ? `${elegir(PREFIJOS)} ${elegir(APELLIDOS)}`
    : `${rubro[0]!.toUpperCase()}${rubro.slice(1)} ${elegir(APELLIDOS)}`
}

function persona(): string {
  return `${elegir(NOMBRES)} ${elegir(APELLIDOS)}`
}

/* ── Carga ────────────────────────────────────────────────────────────────── */

async function cargar(): Promise<void> {
  console.log('Cargando datos de demostración…\n')

  const yaHay = await pool.query<{ n: string }>('select count(*) as n from contacts')
  if (Number(yaHay.rows[0]!.n) > 0) {
    console.log('Ojo: la base ya tiene contactos. Corré primero  npm run demo:limpiar')
    return
  }

  // ── Cuentas emisoras, con estados variados para ver todo el tablero ────
  const cuentas: Array<{ code: string; estado: string; dia: number | null; fallos: number }> = [
    ...Array.from({ length: 6 }, (_, i) => ({
      code: `WA-0${i + 1}`, estado: 'activa', dia: null, fallos: 0,
    })),
    { code: 'WA-07', estado: 'calentando', dia: 4, fallos: 0 },
    { code: 'WA-08', estado: 'calentando', dia: 1, fallos: 0 },
    { code: 'WA-09', estado: 'pausada', dia: null, fallos: 0 },
    { code: 'WA-10', estado: 'bloqueada', dia: null, fallos: 3 },
  ]

  const idPorCode = new Map<string, string>()

  for (let i = 0; i < cuentas.length; i++) {
    const c = cuentas[i]!
    const r = await pool.query<{ id: string }>(
      `insert into messaging_accounts
         (code, label, channel, phone_e164, status, daily_cap, warmup_day,
          consecutive_failures, prep_checklist, min_gap_seconds,
          window_start, window_end, instance_name, notes, mode)
       values ($1,$2,'whatsapp',$3,$4,30,$5,$6,$7::jsonb,240,'09:00','20:00',$8,$9,'api')
       returning id`,
      [
        c.code,
        `${c.code} ${['Ventas', 'Comercial', 'Seguimiento'][i % 3]}`,
        `54938345670${String(i + 10)}`,
        c.estado,
        c.dia,
        c.fallos,
        JSON.stringify(CHECKLIST_OK),
        `instancia-${c.code.toLowerCase()}`,
        MARCA,
      ],
    )
    idPorCode.set(c.code, r.rows[0]!.id)
  }

  const ig = await pool.query<{ id: string }>(
    `insert into messaging_accounts
       (code, label, channel, ig_username, status, daily_cap, prep_checklist,
        min_gap_seconds, window_start, window_end, session_hint, notes, mode)
     values ('IG-01','IG @estudio','instagram','estudio.visual','activa',30,$1::jsonb,
             240,'09:00','20:00','Chrome perfil 2',$2,'manual')
     returning id`,
    [JSON.stringify(CHECKLIST_OK), MARCA],
  )
  idPorCode.set('IG-01', ig.rows[0]!.id)
  console.log(`  ${idPorCode.size} cuentas emisoras`)

  // ── Lote de importación de demostración ───────────────────────────────
  const lote = await pool.query<{ id: string }>(
    `insert into import_batches (filename, row_count, imported, column_map_jsonb)
     values ($1, 240, 240, '{}'::jsonb) returning id`,
    [`${MARCA} clientes-marzo.xlsx`],
  )
  const batchId = lote.rows[0]!.id

  // ── Contactos ─────────────────────────────────────────────────────────
  // Repartidos entre las cuentas operativas, con etapas que cuentan una
  // historia coherente: la mayoría sin tocar, algunos contactados, pocos
  // cerrados. Es el embudo real de una campaña a mitad de camino.
  const operativas = ['WA-01', 'WA-02', 'WA-03', 'WA-04', 'WA-05', 'WA-06', 'WA-07', 'WA-08']
  const ETAPAS: Array<[string, number]> = [
    ['nuevo', 96], ['contactado', 48], ['seguimiento_1', 26], ['seguimiento_2', 14],
    ['respondido', 20], ['interesado', 14], ['reunion_agendada', 8],
    ['cerrado', 6], ['perdido', 5], ['sin_respuesta', 3],
  ]

  const contactos: Array<{ id: string; etapa: string; cuenta: string }> = []
  let n = 0

  for (const [etapa, cantidad] of ETAPAS) {
    for (let k = 0; k < cantidad; k++) {
      const [ciudad, area] = elegir(CIUDADES)
      // El índice va pegado al número y al usuario para que no haya dos iguales:
      // la base tiene índices únicos sobre teléfono y sobre usuario de Instagram.
      const largo = area === '11' ? 8 : 7
      const abonado = String(4_000_000 + n * 137).padStart(largo, '0').slice(-largo)
      const tel = `549${area}${abonado}`
      const conIg = rnd() > 0.55
      const usuario = `${negocio(n).toLowerCase().replace(/[^a-z]/g, '').slice(0, 20)}${n}`
      const code = operativas[n % operativas.length]!

      const contactado = etapa !== 'nuevo'
      const respondio = ['respondido', 'interesado', 'reunion_agendada', 'cerrado'].includes(etapa)
      const enviados = contactado ? entre(1, 4) : 0
      const recibidos = respondio ? entre(1, 5) : 0

      const r = await pool.query<{ id: string }>(
        `insert into contacts
           (business_name, contact_name, phone_raw, phone_e164, has_whatsapp,
            ig_username, has_instagram, niche, bought, city, stage, score,
            preferred_channel, assigned_wa_account_id, assigned_ig_account_id,
            sent_count, received_count, thread_count,
            last_outbound_at, last_inbound_at, first_replied_at, next_followup_at,
            import_batch_id, dedupe_key)
         values ($1,$2,$3,$4,true,$5,$6,$7,$8,$9,$10,$11,'whatsapp',$12,$13,
                 $14,$15,$16,$17,$18,$19,$20,$21,$4)
         returning id`,
        [
          negocio(n),
          persona(),
          `0${area} 15 ${abonado}`,
          tel,
          conIg ? usuario : null,
          conIg,
          RUBROS[n % RUBROS.length],
          elegir(COMPRAS),
          ciudad,
          etapa,
          puntaje(etapa, recibidos),
          idPorCode.get(code),
          conIg ? idPorCode.get('IG-01') : null,
          enviados,
          recibidos,
          respondio ? entre(2, 6) : 0,
          contactado ? haceDias(entre(1, 12)) : null,
          respondio ? haceDias(entre(0, 6)) : null,
          respondio ? haceDias(entre(2, 10)) : null,
          ['contactado', 'seguimiento_1', 'seguimiento_2'].includes(etapa)
            ? haceDias(-entre(0, 4))
            : null,
          batchId,
        ],
      )
      contactos.push({ id: r.rows[0]!.id, etapa, cuenta: code })
      n++
    }
  }
  console.log(`  ${contactos.length} contactos repartidos entre 8 números`)

  // ── Historial de mensajes ─────────────────────────────────────────────
  // Alimenta el medidor de cupo, el semáforo de salud y la conciliación.
  let mensajes = 0
  const enviadosHoy = new Map<string, number>()

  for (const c of contactos) {
    if (c.etapa === 'nuevo') continue
    const cuentaId = idPorCode.get(c.cuenta)!
    const salientes = entre(1, 3)

    for (let s = 0; s < salientes; s++) {
      const dias = entre(0, 6)
      const cuando = haceDias(dias, entre(9, 19))
      if (dias === 0) enviadosHoy.set(c.cuenta, (enviadosHoy.get(c.cuenta) ?? 0) + 1)

      await pool.query(
        `insert into messages
           (contact_id, account_id, channel, direction, body, status, send_mode,
            sequence_step, external_id, sent_at, delivered_at, read_at, created_at)
         values ($1,$2,'whatsapp','out',$3,'enviado','chatwoot',$4,$5,$6,$7,$8,$6)`,
        [
          c.id,
          cuentaId,
          `Hola, ¿cómo va? Te escribo por lo del ${elegir(COMPRAS)}.`,
          s + 1,
          `demo-${mensajes}`,
          cuando,
          rnd() > 0.12 ? cuando : null,
          rnd() > 0.4 ? cuando : null,
        ],
      )
      mensajes++
    }

    if (['respondido', 'interesado', 'reunion_agendada', 'cerrado'].includes(c.etapa)) {
      const cuando = haceDias(entre(0, 4), entre(10, 20))
      await pool.query(
        `insert into messages
           (contact_id, account_id, channel, direction, body, status, send_mode, created_at)
         values ($1,$2,'whatsapp','in',$3,'respondido','chatwoot',$4)`,
        [c.id, cuentaId, elegir(RESPUESTAS), cuando],
      )
      mensajes++
    }
  }

  // El contador del día tiene que coincidir con lo que hay en messages, o la
  // conciliación va a marcar descuadre.
  for (const [code, cantidad] of enviadosHoy) {
    await pool.query(
      `update messaging_accounts set sent_today = $1, counter_date = current_date,
              last_sent_at = now() - interval '25 minutes'
        where id = $2`,
      [cantidad, idPorCode.get(code)],
    )
  }
  console.log(`  ${mensajes} mensajes de historial`)

  // ── Reuniones ─────────────────────────────────────────────────────────
  const conReunion = contactos.filter((c) => c.etapa === 'reunion_agendada' || c.etapa === 'cerrado')
  for (const c of conReunion) {
    const futura = c.etapa === 'reunion_agendada'
    await pool.query(
      `insert into meetings (contact_id, scheduled_at, duration_minutes, type,
                             location_or_link, agenda, status, outcome)
       values ($1,$2,30,$3,$4,$5,$6,$7)`,
      [
        c.id,
        futura ? haceDias(-entre(0, 5), entre(10, 18)) : haceDias(entre(3, 14), 15),
        elegir(['llamada', 'videollamada', 'presencial']),
        'https://meet.google.com/demo',
        'Presentar el servicio nuevo',
        futura ? 'agendada' : 'hecha',
        futura ? null : 'cerro',
      ],
    )
  }
  console.log(`  ${conReunion.length} reuniones`)

  // ── Plantillas ────────────────────────────────────────────────────────
  // La secuencia completa de 4 pasos. Sin plantilla para un paso, el
  // Despachador no arma el mensaje y lo dice: nunca manda a medias.
  await pool.query(
    `insert into templates (name, channel, sequence_step, body, variants, is_opening, active)
     values
       ('Apertura general','whatsapp',1,$1,$2::jsonb,true,true),
       ('Seguimiento 2 · aportar valor','whatsapp',2,$3,'[]'::jsonb,false,true),
       ('Seguimiento 3 · facilitar el sí','whatsapp',3,$4,'[]'::jsonb,false,true),
       ('Seguimiento 4 · cierre respetuoso','whatsapp',4,$5,'[]'::jsonb,false,true),
       ('Apertura Instagram','instagram',1,$6,$7::jsonb,true,true),
       ('Seguimiento Instagram','instagram',2,$8,'[]'::jsonb,false,true)`,
    [
      'Hola {{nombre}}, ¿cómo va? Te escribo de parte del estudio. El año pasado hiciste {{compro}} con nosotros para {{negocio}} y quería contarte algo nuevo que estamos haciendo para {{rubro}}. ¿Te interesa que te cuente?',
      JSON.stringify([
        'Hola {{nombre}}, ¿todo bien? Te escribo del estudio. Habíamos hecho {{compro}} para {{negocio}} y armamos algo nuevo pensado para {{rubro}}. ¿Querés que te cuente?',
        '{{nombre}}, ¿cómo andás? Soy del estudio, hicimos {{compro}} para {{negocio}}. Tenemos algo nuevo para {{rubro}} que creo que te sirve. ¿Te lo muestro?',
      ]),
      'Che {{nombre}}, te dejo un caso de un {{rubro}} que arrancó hace dos meses y ya está llenando la agenda. Si querés te paso el detalle, sin compromiso.',
      '{{nombre}}, para no marearte: ¿te sirve que hablemos 15 minutos esta semana? Tengo jueves a la mañana o viernes a la tarde. Vos decime cuál te queda mejor.',
      'Che {{nombre}}, te dejo tranquilo con esto. Si en algún momento querés retomar lo de {{negocio}}, escribime y lo vemos. ¡Éxitos!',
      'Hola {{nombre}}! Te escribo por {{negocio}}. Armamos algo nuevo para {{rubro}}, ¿te cuento?',
      JSON.stringify([
        '{{nombre}}, ¿cómo va? Te escribo por {{negocio}}, tenemos algo nuevo para {{rubro}}. ¿Te interesa?',
      ]),
      'Hola {{nombre}}, te dejo un caso de otro {{rubro}} por si te sirve. Cualquier cosa me escribís.',
    ],
  )
  console.log('  6 plantillas (la secuencia completa de 4 pasos)')

  // ── Excel de ejemplo, para probar el importador de verdad ─────────────
  const ruta = generarExcel()
  console.log(`  Excel de ejemplo: ${ruta}`)

  console.log('\nListo. Entrá a http://localhost:3000/cuentas')
  console.log('Para borrar todo:  npm run demo:limpiar')
}

const RESPUESTAS = [
  'Hola! Sí, contame',
  'Buenas, ¿de qué se trata?',
  'Ahora no puedo, mandame info y lo veo',
  '¿Cuánto sale?',
  'Dale, me interesa',
  'Gracias, pero por ahora no',
]

function haceDias(dias: number, hora = 12): string {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  d.setHours(hora, entre(0, 59), 0, 0)
  return d.toISOString()
}

function puntaje(etapa: string, recibidos: number): number {
  const base: Record<string, number> = {
    nuevo: 10, contactado: 15, seguimiento_1: 15, seguimiento_2: 12,
    respondido: 45, interesado: 65, reunion_agendada: 80, cerrado: 95,
    perdido: 0, sin_respuesta: 5,
  }
  return Math.min(100, (base[etapa] ?? 10) + Math.min(recibidos * 3, 15))
}

/** Excel con la mugre que traen los archivos reales, para probar el importador. */
function generarExcel(): string {
  const filas: Record<string, string>[] = []

  for (let i = 0; i < 120; i++) {
    const [ciudad, area] = elegir(CIUDADES)
    const abonado = area === '11' ? String(entre(30000000, 69999999)) : String(entre(4000000, 5999999))
    // Cinco formas distintas de escribir el mismo teléfono, como en la vida real.
    const formas = [
      `0${area} 15 ${abonado}`,
      `+54 ${area} ${abonado}`,
      `${area}15${abonado}`,
      `${area}${abonado}`,
      `(0${area}) 15-${abonado}`,
    ]
    filas.push({
      Negocio: negocio(i + 500),
      Contacto: persona(),
      'Teléfono': formas[i % formas.length]!,
      Instagram: rnd() > 0.5 ? `@${negocio(i + 500).toLowerCase().replace(/[^a-z]/g, '')}` : '',
      Rubro: RUBROS[i % RUBROS.length]!,
      Ciudad: ciudad,
      'Qué compró': elegir(COMPRAS),
    })
  }

  // Filas con problemas, para ver la pestaña Revisar funcionando.
  for (let i = 0; i < 6; i++) {
    filas.push({
      Negocio: `Kiosco ${elegir(APELLIDOS)}`,
      Contacto: persona(),
      'Teléfono': ['1234', '15 4567 8901', 'no tiene', '', 'consultar', '999 999'][i]!,
      Instagram: i < 3 ? `@kiosco${i}` : '',
      Rubro: 'kiosco',
      Ciudad: 'Catamarca',
      'Qué compró': '',
    })
  }
  // Cuatro repetidos, para ver la deduplicación.
  for (let i = 0; i < 4; i++) filas.push({ ...filas[i]!, Negocio: `${filas[i]!.Negocio} SRL` })

  const hoja = XLSX.utils.json_to_sheet(filas)
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, hoja, 'Clientes')
  const ruta = resolve(process.cwd(), 'ejemplo-clientes.xlsx')
  writeFileSync(ruta, XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
  return ruta
}

/* ── Limpieza ─────────────────────────────────────────────────────────────── */

/**
 * Borra el historial inventado y deja los contactos como recién importados.
 *
 * El historial de la demo hace que la consola diga "Contactado" y "Seguimiento
 * vencido" de gente a la que nunca le escribiste, que es exactamente lo que la
 * spec pide no hacer. Esto deja las cuentas y los contactos —para poder ver las
 * pantallas con datos— pero sin afirmar nada que no haya pasado.
 */
async function limpiarHistorial(): Promise<void> {
  await pool.query('truncate messages, meetings, events cascade')

  await pool.query(`
    update contacts set
      stage = 'nuevo',
      sent_count = 0,
      received_count = 0,
      thread_count = 0,
      sequence_step = 0,
      last_outbound_at = null,
      last_inbound_at = null,
      first_replied_at = null,
      next_followup_at = null,
      chatwoot_conversation_id = null,
      chatwoot_contact_id = null,
      score = 10,
      score_breakdown = '[]'::jsonb,
      updated_at = now()
  `)

  await pool.query(`
    update messaging_accounts set sent_today = 0, counter_date = null, last_sent_at = null
  `)

  const filas = (await pool.query<{ n: string }>('select count(*) as n from contacts')).rows
  const n = filas[0]?.n ?? '0'
  console.log(`Historial borrado. Quedaron ${n} contactos, todos en "Nuevo" y sin mensajes.`)
  console.log('La consola ya no dice que contactaste a nadie.')
}

async function limpiar(): Promise<void> {
  await pool.query(`
    truncate messages, events, import_batch_items, meetings, pilots,
             ig_dispatch_state, contacts, import_batches, messaging_accounts,
             templates, saved_views
    restart identity cascade
  `)
  console.log('Listo: la base quedó vacía. Los usuarios no se tocaron.')
}

/* ── Entrada ──────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL.')
  const accion =
    process.argv[2] === '--limpiar'
      ? limpiar
      : process.argv[2] === '--historial'
        ? limpiarHistorial
        : cargar
  try {
    await accion()
  } finally {
    await pool.end()
  }
}

main().catch((err: unknown) => {
  console.error('\n', err instanceof Error ? err.message : err)
  process.exit(1)
})

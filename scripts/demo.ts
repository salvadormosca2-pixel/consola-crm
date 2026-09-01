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
 *   npm run demo:setters     equipo de setters, plantillas de IG y un pozo de leads
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
  'página web', 'CRM a medida', 'automatización de WhatsApp',
  'tienda online', 'sistema de turnos', 'integración con facturación',
  'automatización de presupuestos', 'rediseño de la web',
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
             ig_dispatch_state, setter_sends, lead_assignments, setter_accounts,
             mensajes_destinatarios, mensajes_equipo, recordatorios, notificaciones,
             push_subscriptions, setters,
             contacts, import_batches, messaging_accounts,
             templates, referencias, saved_views
    restart identity cascade
  `)
  // Los setters se borran con `setters`, pero su usuario queda: borrarlo sería
  // tocar el padrón de personas, y el disparador de la cuenta madre existe
  // justamente para que un `truncate` de demo no se lleve puesto un acceso.
  await pool.query(`delete from users where role = 'setter'`)
  console.log('Listo: la base quedó vacía. Los admins no se tocaron.')
}

/* ── Equipo de setters ────────────────────────────────────────────────────── */

const SETTERS_DEMO = [
  { nombre: 'Abril Quiroga', email: 'abril@demo.local', cuentas: ['abril.contacta', 'abril.estudio'] },
  { nombre: 'Bruno Herrera', email: 'bruno@demo.local', cuentas: ['bruno.dm'] },
  { nombre: 'Carla Vega', email: 'carla@demo.local', cuentas: ['carla.link', 'carla.mensajes'] },
  // Recién dado de alta. Tiene un único lead y es el real: sirve para grabar
  // el recorrido entero —abrir Instagram, marcar enviado, día completado,
  // pedir más leads— sin que se cruce nada más en la cola.
  { nombre: 'Diego Sosa', email: 'diego@demo.local', cuentas: ['diego.dm'] },
]

const CLAVE_DEMO = 'demo-setters-2026'

/**
 * Equipo de prueba: tres setters con sus cuentas, las dos plantillas de
 * Instagram y un pozo de leads scrapeados para repartir.
 *
 *   npm run demo:setters
 *
 * Sirve para ver el módulo funcionando de punta a punta sin dar de alta a nadie
 * de verdad. Todos entran con la misma contraseña, que se imprime al final.
 */
const TZ = process.env.OPS_TIMEZONE ?? 'America/Argentina/Catamarca'

async function cargarSetters(): Promise<void> {
  const { hash } = await import('@node-rs/argon2')
  const passwordHash = await hash(CLAVE_DEMO, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })

  /*
   * Se rehace desde cero cada vez. El estado que arma —cupos consumidos,
   * seguimientos atrasados, respuestas esperando— depende de las horas
   * relativas a "ahora", así que correrlo dos veces sobre lo anterior dejaría
   * un día sin sentido.
   */
  await pool.query(`
    truncate setter_sends, lead_assignments, setter_accounts, mensajes_destinatarios,
             mensajes_equipo, recordatorios, notificaciones, push_subscriptions, setters
    restart identity cascade
  `)
  await pool.query(`delete from users where role = 'setter'`)
  await pool.query(`delete from contacts where origen = 'scrapeado'`)
  // Los eventos de los setters se reconstruyen más abajo: si quedaran los de
  // la corrida anterior, la pantalla de Actividad contaría el doble.
  await pool.query(`delete from events where actor_user_id is null and contact_id is null`)
  await pool.query(`delete from templates where name like 'DEMO%'`)

  /* ── Los cinco mensajes ─────────────────────────────────────────────────
     Uno por situación. **Son de relleno**: están para que la demostración
     funcione, no para usarlos. Los reales los escribe el admin en Mensajes,
     con sus palabras y por rubro.                                          */

  const PLANTILLAS: Array<{ paso: number; nombre: string; cuerpo: string; variantes: string[] }> = [
    {
      paso: 1,
      nombre: 'DEMO entrada',
      cuerpo: 'Hola! Vi el perfil de {{negocio}}, quería hacerte una consulta. ¿Estás?',
      variantes: [
        'Buenas! Una pregunta sobre {{negocio}}, ¿me podés ayudar?',
        'Hola! Te escribo por {{negocio}}, ¿tenés un minuto?',
      ],
    },
    {
      paso: 2,
      nombre: 'DEMO oferta',
      cuerpo:
        'Te cuento en dos líneas: hacemos {{oferta}} para negocios como {{negocio}}. Si querés te muestro algo parecido a lo tuyo, sin compromiso.',
      variantes: [],
    },
    {
      paso: 3,
      nombre: 'DEMO nunca contestó',
      cuerpo:
        'Che, te escribí por {{negocio}} y capaz se te pasó. Si no te interesa no hay drama, avisame y no te escribo más.',
      variantes: [],
    },
    {
      paso: 4,
      nombre: 'DEMO contestó y se enfrió',
      cuerpo:
        'Hola! Quedamos por la mitad la otra vez. ¿Seguís interesado o lo dejamos para más adelante?',
      variantes: [],
    },
    {
      paso: 5,
      nombre: 'DEMO le interesó y se enfrió',
      cuerpo:
        'Hola! Habíamos quedado en avanzar con lo de {{oferta}}. ¿Te viene bien una llamada esta semana o lo vemos más adelante?',
      variantes: [],
    },
  ]

  for (const t of PLANTILLAS) {
    await pool.query(
      `insert into templates (name, channel, sequence_step, body, variants, active, is_opening,
                              pilot_status)
       values ($1, 'instagram', $2, $3, $4::jsonb, true, $5, 'aprobada')`,
      [t.nombre, t.paso, t.cuerpo, JSON.stringify(t.variantes), t.paso === 1],
    )
  }

  // El mensaje de la oferta usa {{oferta}}: sin esto no se puede armar y todos
  // los leads quedarían bloqueados en la cola.
  await pool.query(
    `insert into settings (key, value_jsonb, updated_at)
     values ('mensajes', $1::jsonb, now())
     on conflict (key) do update set value_jsonb = excluded.value_jsonb, updated_at = now()`,
    [JSON.stringify({ miNombre: 'Salvador', oferta: 'webs, automatizaciones y CRM' })],
  )

  /* ── Referencias ────────────────────────────────────────────────────────
     Lo que el setter lee cuando el cliente pregunta algo que no estaba en el
     guion. **También son de relleno**: las reales las escribe el admin.     */

  await pool.query(`delete from referencias`)

  const REFERENCIAS: Array<{
    categoria: string
    pregunta: string
    respuesta: string
    nota?: string
  }> = [
    /* ── Sobre nosotros ── */
    {
      categoria: 'nosotros',
      pregunta: '¿Quiénes son?',
      respuesta:
        'Somos un estudio chico: hacemos páginas web, automatizaciones y sistemas de gestión de clientes. Trabajamos con negocios que ya venden y están perdiendo tiempo en tareas repetitivas.',
    },
    {
      categoria: 'nosotros',
      pregunta: '¿A qué se dedican exactamente?',
      respuesta:
        'Tres cosas: la web del negocio, un CRM para no perder ningún cliente de vista, y automatizaciones que hacen solas lo que hoy hacen a mano (responder consultas, cargar datos, mandar recordatorios).',
    },
    {
      categoria: 'nosotros',
      pregunta: '¿Con quién trabajaron?',
      respuesta:
        'Con negocios de rubros parecidos al tuyo: comercios, servicios y consultorios. Si querés te muestro algo del mismo rubro para que veas cómo queda.',
      nota: 'No inventes nombres de clientes. Si insiste, pasámelo a mí.',
    },

    /* ── Cómo funciona ── */
    {
      categoria: 'como_funciona',
      pregunta: '¿Cómo es el proceso?',
      respuesta:
        'Primero una llamada de 20 minutos para ver cómo trabajás hoy y qué se puede sacar de encima. Con eso te paso una propuesta con precio cerrado. Si va, arrancamos.',
    },
    {
      categoria: 'como_funciona',
      pregunta: '¿Cuánto tardan?',
      respuesta:
        'Una web queda en 2 o 3 semanas. El CRM y las automatizaciones dependen de qué tan grande sea, pero siempre entregamos por partes: a las 2 semanas ya tenés algo funcionando.',
    },
    {
      categoria: 'como_funciona',
      pregunta: '¿Qué necesitan de mí?',
      respuesta:
        'Media hora al principio para contarnos cómo trabajás, y los textos y fotos si ya los tenés. Si no los tenés, los armamos nosotros.',
    },
    {
      categoria: 'como_funciona',
      pregunta: '¿Qué es una automatización?',
      respuesta:
        'Algo que hoy hacés a mano y pasa a hacerse solo: que un mensaje de WhatsApp cargue el cliente en tu lista, que salga el recordatorio del turno, que el presupuesto se arme sin que lo escribas.',
      nota: 'Contestá con un ejemplo del rubro que tenga el lead, no con la definición.',
    },
    {
      categoria: 'como_funciona',
      pregunta: '¿Yo lo puedo manejar después?',
      respuesta:
        'Sí, esa es la idea. Te dejamos todo cargado y te enseñamos a usarlo en una llamada. No queda atado a nosotros.',
    },

    /* ── Precio y pago ── */
    {
      categoria: 'precio',
      pregunta: '¿Cuánto sale?',
      respuesta:
        'Depende de qué necesites: no es lo mismo una web sola que una web con CRM y automatizaciones. Contame un poco cómo trabajás hoy y te paso el número exacto.',
      nota: 'No tires un precio suelto: primero entendé qué necesita.',
    },
    {
      categoria: 'precio',
      pregunta: '¿Cómo se paga?',
      respuesta:
        'La mitad para arrancar y la otra mitad al entregar, por transferencia. Si sumás mantenimiento, eso es un mensual aparte.',
    },
    {
      categoria: 'precio',
      pregunta: '¿Hay costo mensual?',
      respuesta:
        'El desarrollo se paga una vez. Después hay un mensual opcional de mantenimiento y soporte, que podés no tomar o cortar cuando quieras.',
    },

    /* ── Objeciones ── */
    {
      categoria: 'objeciones',
      pregunta: 'Es caro',
      respuesta:
        'Te entiendo. Mirálo por lo que te ahorra: si hoy perdés dos horas por día cargando datos o contestando lo mismo, eso ya cuesta más que el sistema. Igual podemos arrancar por una parte sola.',
    },
    {
      categoria: 'objeciones',
      pregunta: 'Lo tengo que pensar',
      respuesta: 'Dale, sin apuro. ¿Te escribo la semana que viene o preferís avisarme vos?',
      nota: 'Si dice que avisa él, marcalo igual: el seguimiento sale solo.',
    },
    {
      categoria: 'objeciones',
      pregunta: 'Ya tengo página web',
      respuesta:
        'Buenísimo. La mayoría de lo que hacemos no es la web sino lo de atrás: que los clientes que llegan queden ordenados y que el seguimiento salga solo. Eso se puede sumar a la que ya tenés.',
    },
    {
      categoria: 'objeciones',
      pregunta: 'Ya trabajo con alguien',
      respuesta:
        'Mejor que estés cubierto. Si en algún momento necesitás algo puntual —una automatización, ordenar la base de clientes— avisame y lo vemos.',
    },
    {
      categoria: 'objeciones',
      pregunta: 'No entiendo mucho de tecnología',
      respuesta:
        'No hace falta. Vos contás cómo trabajás y nosotros lo armamos. Después se usa como WhatsApp: entrás y está todo ahí.',
    },

    /* ── Otras ── */
    {
      categoria: 'otras',
      pregunta: '¿Me pasás ejemplos?',
      respuesta:
        'Sí, te paso dos o tres del rubro tuyo así ves algo parecido a lo que necesitás. ¿A qué se dedica el negocio exactamente?',
      nota: 'Aprovechá para que te cuente el rubro: sirve para la propuesta.',
    },
    {
      categoria: 'otras',
      pregunta: '¿Dónde están?',
      respuesta:
        'Trabajamos a distancia con clientes de todo el país. Las reuniones son por videollamada y la entrega es la misma.',
    },
    {
      categoria: 'otras',
      pregunta: '¿Hacen mantenimiento?',
      respuesta:
        'Sí. Podés tomar un mensual de soporte y cambios, o dejarlo andando solo y llamarnos cuando necesites algo.',
    },
  ]

  for (const [i, r] of REFERENCIAS.entries()) {
    await pool.query(
      `insert into referencias (categoria, pregunta, respuesta, nota, orden)
       values ($1, $2, $3, $4, $5)`,
      [r.categoria, r.pregunta, r.respuesta, r.nota ?? null, i],
    )
  }

  // ── Los setters ─────────────────────────────────────────────────────────
  const ids: Record<string, { setterId: string; userId: string; cuentas: string[] }> = {}

  for (const [i, s] of SETTERS_DEMO.entries()) {
    const u = await pool.query<{ id: string }>(
      // `last_login_at` puesto: son setters que ya trabajan, y el reparto
      // saltea al que todavía no estrenó su acceso. Sin esto la demo arranca
      // con el pozo lleno y todas las colas vacías.
      `insert into users (email, name, password_hash, role, status,
                          must_change_password, last_login_at)
       values ($1, $2, $3, 'setter', 'activo', false, now())
       returning id`,
      [s.email, s.nombre, passwordHash],
    )
    const userId = u.rows[0]!.id

    const setter = await pool.query<{ id: string }>(
      `insert into setters (user_id, tanda_diaria, variante, recordatorio_automatico,
                            hora_recordatorio)
       values ($1, $2, $3, $4, '10:00') returning id`,
      [userId, s.cuentas.length * 30, i, i === 1],
    )
    const setterId = setter.rows[0]!.id

    const cuentas: string[] = []
    for (const [j, cuenta] of s.cuentas.entries()) {
      const c = await pool.query<{ id: string }>(
        `insert into setter_accounts (setter_id, ig_username, cupo_diario, orden)
         values ($1, $2, 30, $3) returning id`,
        [setterId, cuenta, j + 1],
      )
      cuentas.push(c.rows[0]!.id)
    }

    ids[s.email] = { setterId, userId, cuentas }
  }

  const abril = ids['abril@demo.local']!
  const bruno = ids['bruno@demo.local']!
  const carla = ids['carla@demo.local']!

  /* ── Fábrica de leads ───────────────────────────────────────────────────
     Cada lead es un negocio inventado con su asignación y, si corresponde,
     sus envíos ya registrados. Los envíos se fechan a mano para poder armar
     un día que se parezca a uno real: cupos consumidos, seguimientos
     atrasados y respuestas esperando. */

  const rnd = azar(7)
  let n = 0

  async function crearLead(opts: {
    setterId?: string
    cuentaId?: string
    estado?: string
    /** Envíos ya hechos: cuántos días atrás salió cada uno. */
    envios?: Array<{ tipo: 'primero' | 'segundo'; diasAtras: number }>
    /** Horas desde ahora hasta el segundo mensaje. Negativo = atrasado. */
    segundoEnHoras?: number | null
    horasParaVencer?: number
    respondidoHaceHoras?: number
    reunionEnHoras?: number
    cerrado?: boolean
    nota?: string
    motivo?: string
    /** Un lead de verdad, para poder grabar el sistema abriendo Instagram. */
    real?: { negocio: string; usuario: string; rubro: string; ciudad: string }
  }): Promise<void> {
    n++
    const nombre = opts.real?.negocio ?? negocio(n)
    const usuario =
      opts.real?.usuario ??
      nombre
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 22) + n

    const etapa = opts.cerrado
      ? 'cerrado'
      : opts.reunionEnHoras !== undefined
        ? 'reunion_agendada'
        : opts.respondidoHaceHoras !== undefined
          ? 'respondido'
          : (opts.envios?.length ?? 0) > 0
            ? 'contactado'
            : opts.estado === 'cuenta_inexistente'
              ? 'descartado'
              : 'nuevo'

    const c = await pool.query<{ id: string }>(
      `insert into contacts (business_name, ig_username, has_instagram, niche, city,
                             origen, preferred_channel, score, dedupe_key, stage,
                             setter_id, sent_count, received_count,
                             last_outbound_at, last_inbound_at, first_replied_at,
                             discarded_at)
       values ($1::text, $2::text, true, $3::text, $4::text, 'scrapeado', 'instagram',
               $5::int, $6::text, $7::contact_stage,
               $8::uuid, $9::int, $10::int,
               case when $9::int > 0 then now() - ($11::text || ' days')::interval else null end,
               case when $10::int > 0 then now() - ($12::text || ' hours')::interval else null end,
               case when $10::int > 0 then now() - ($12::text || ' hours')::interval else null end,
               case when $13::boolean then now() else null end)
       returning id`,
      [
        nombre,
        usuario,
        opts.real?.rubro ?? RUBROS[Math.floor(rnd() * RUBROS.length)],
        // CIUDADES son pares [ciudad, característica]: va solo el nombre. Pasar
        // la tupla entera guardaba la ciudad como {"Salta","387"}.
        opts.real?.ciudad ?? CIUDADES[Math.floor(rnd() * CIUDADES.length)]![0],
        10 + Math.floor(rnd() * 60),
        `ig:${usuario}`,
        etapa,
        opts.envios?.length ? (opts.setterId ?? null) : null,
        opts.envios?.length ?? 0,
        opts.respondidoHaceHoras !== undefined || opts.reunionEnHoras !== undefined || opts.cerrado
          ? 1
          : 0,
        String(opts.envios?.[0]?.diasAtras ?? 0),
        String(opts.respondidoHaceHoras ?? 0),
        opts.estado === 'cuenta_inexistente',
      ],
    )
    const contactId = c.rows[0]!.id

    if (!opts.setterId) return

    const a = await pool.query<{ id: string }>(
      `insert into lead_assignments (contact_id, setter_id, setter_account_id, estado,
                                     asignado_at, vence_at, abierto_at, contactado_at,
                                     segundo_programado_at, segundo_mensaje_at,
                                     respondido_at, devuelto_at, devuelto_motivo, nota)
       values ($1::uuid, $2::uuid, $3::uuid, $4::lead_assignment_estado,
               now() - ($5::text || ' hours')::interval,
               now() + ($6::text || ' hours')::interval,
               case when $4::text <> 'asignado' then now() - ($5::text || ' hours')::interval else null end,
               case when $7::boolean then now() - ($8::text || ' days')::interval else null end,
               case when $9::text is null then null else now() + ($9::text || ' hours')::interval end,
               case when $10::boolean then now() - interval '2 hours' else null end,
               case when $11::text is null then null else now() - ($11::text || ' hours')::interval end,
               case when $4::text in ('vencido','devuelto','cuenta_inexistente') then now() else null end,
               $12::text, $13::text)
       returning id`,
    // `proximo_paso` y `proximo_seguimiento_at` se completan después, en un
    // solo paso al final: dependen del estado en que quedó cada lead.
      [
        contactId,
        opts.setterId,
        opts.envios?.length ? (opts.cuentaId ?? null) : null,
        opts.estado ?? 'asignado',
        String((opts.envios?.[0]?.diasAtras ?? 0) * 24 + 2),
        String(opts.horasParaVencer ?? 40),
        (opts.envios?.length ?? 0) > 0,
        String(opts.envios?.[0]?.diasAtras ?? 0),
        opts.segundoEnHoras === null || opts.segundoEnHoras === undefined
          ? null
          : String(opts.segundoEnHoras),
        (opts.envios ?? []).some((e) => e.tipo === 'segundo'),
        opts.respondidoHaceHoras === undefined ? null : String(opts.respondidoHaceHoras),
        opts.motivo ?? null,
        opts.nota ?? null,
      ],
    )
    const assignmentId = a.rows[0]!.id

    for (const envio of opts.envios ?? []) {
      await pool.query(
        `insert into setter_sends (assignment_id, setter_id, setter_account_id, contact_id,
                                   tipo, paso, ops_date, sent_at)
         values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::setter_send_tipo, $8::int,
                 (now() at time zone $7::text)::date - ($6::text)::int,
                 now() - ($6::text || ' days')::interval - (random() * interval '6 hours'))`,
        [
          assignmentId,
          opts.setterId,
          opts.cuentaId,
          contactId,
          envio.tipo,
          String(envio.diasAtras),
          TZ,
          envio.tipo === 'primero' ? 1 : 2,
        ],
      )
    }

    if (opts.reunionEnHoras !== undefined) {
      await pool.query(
        `insert into meetings (contact_id, scheduled_at, type, setter_id, notes)
         values ($1, now() + ($2 || ' hours')::interval, 'videollamada', $3, $4)`,
        [contactId, String(opts.reunionEnHoras), opts.setterId, 'Quiere ver precios.'],
      )
    }
  }

  /* ── Abril: día avanzado, cuenta A al tope y B a mitad ──────────────── */

  // 30 en la cuenta A (al tope) y 12 en la B: 42 mensajes hoy sobre 60.
  for (let i = 0; i < 18; i++) {
    await crearLead({
      setterId: abril.setterId,
      cuentaId: abril.cuentas[0],
      estado: 'segundo_enviado',
      envios: [
        { tipo: 'primero', diasAtras: 1 },
        { tipo: 'segundo', diasAtras: 0 },
      ],
      segundoEnHoras: null,
    })
  }
  for (let i = 0; i < 12; i++) {
    await crearLead({
      setterId: abril.setterId,
      cuentaId: abril.cuentas[0],
      estado: 'contactado',
      envios: [{ tipo: 'primero', diasAtras: 0 }],
      segundoEnHoras: 20,
    })
  }
  for (let i = 0; i < 12; i++) {
    await crearLead({
      setterId: abril.setterId,
      cuentaId: abril.cuentas[1],
      estado: 'contactado',
      envios: [{ tipo: 'primero', diasAtras: 0 }],
      segundoEnHoras: 22,
    })
  }

  // Cinco seguimientos que todavía le faltan hoy.
  for (let i = 0; i < 5; i++) {
    await crearLead({
      setterId: abril.setterId,
      cuentaId: abril.cuentas[1],
      estado: 'contactado',
      envios: [{ tipo: 'primero', diasAtras: 1 }],
      segundoEnHoras: -2,
    })
  }

  // Leads nuevos esperando el primer mensaje.
  for (let i = 0; i < 10; i++) {
    await crearLead({ setterId: abril.setterId, horasParaVencer: 30 + i })
  }

  /*
   * Seis que contestaron la entrada y esperan la oferta. Van **sin nota** a
   * propósito: al marcar el primer mensaje la app no le pide nada escrito al
   * setter, porque lo que dijeron ahí es un "hola" y anotarlo no le sirve a
   * nadie. Lo que sí es obligatorio es la nota al contestar la oferta.
   */
  for (let i = 0; i < 6; i++) {
    await crearLead({
      setterId: abril.setterId,
      cuentaId: abril.cuentas[0],
      estado: 'respondido',
      envios: [{ tipo: 'primero', diasAtras: 2 }],
      segundoEnHoras: null,
      respondidoHaceHoras: 2 + i * 5,
    })
  }

  await crearLead({
    setterId: abril.setterId,
    cuentaId: abril.cuentas[0],
    estado: 'respondido',
    envios: [{ tipo: 'primero', diasAtras: 3 }],
    segundoEnHoras: null,
    respondidoHaceHoras: 26,
    reunionEnHoras: 20,
  })
  await crearLead({
    setterId: abril.setterId,
    cuentaId: abril.cuentas[1],
    estado: 'respondido',
    envios: [{ tipo: 'primero', diasAtras: 4 }],
    segundoEnHoras: null,
    respondidoHaceHoras: 50,
    reunionEnHoras: 72,
  })
  await crearLead({
    setterId: abril.setterId,
    cuentaId: abril.cuentas[0],
    estado: 'respondido',
    envios: [{ tipo: 'primero', diasAtras: 9 }],
    segundoEnHoras: null,
    respondidoHaceHoras: 200,
    cerrado: true,
  })

  // La cuenta activa es la segunda: ya cambió cuando la primera llegó a 30.
  await pool.query(
    `update setters set cuenta_activa_id = $1, cuenta_activa_desde = now() - interval '2 hours'
      where id = $2`,
    [abril.cuentas[1], abril.setterId],
  )

  /* ── Bruno: no arrancó, y arrastra dos días de atraso ────────────────── */

  for (let i = 0; i < 15; i++) {
    await crearLead({
      setterId: bruno.setterId,
      cuentaId: bruno.cuentas[0],
      estado: 'contactado',
      envios: [{ tipo: 'primero', diasAtras: 3 }],
      segundoEnHoras: -48,
    })
  }
  for (let i = 0; i < 12; i++) {
    await crearLead({
      setterId: bruno.setterId,
      // Cuatro se le vencen hoy: es lo que dispara el aviso.
      horasParaVencer: i < 4 ? 4 + i : 30 + i,
    })
  }

  /* ── Carla: terminó el día completo ──────────────────────────────────── */

  for (let i = 0; i < 21; i++) {
    await crearLead({
      setterId: carla.setterId,
      cuentaId: carla.cuentas[i < 11 ? 0 : 1],
      estado: 'segundo_enviado',
      envios: [
        { tipo: 'primero', diasAtras: 1 },
        { tipo: 'segundo', diasAtras: 0 },
      ],
      segundoEnHoras: null,
    })
  }
  for (let i = 0; i < 17; i++) {
    await crearLead({
      setterId: carla.setterId,
      cuentaId: carla.cuentas[0],
      estado: 'contactado',
      envios: [{ tipo: 'primero', diasAtras: 0 }],
      segundoEnHoras: 21,
    })
  }
  for (let i = 0; i < 19; i++) {
    await crearLead({
      setterId: carla.setterId,
      cuentaId: carla.cuentas[1],
      estado: 'contactado',
      envios: [{ tipo: 'primero', diasAtras: 0 }],
      segundoEnHoras: 23,
    })
  }
  for (let i = 0; i < 4; i++) {
    await crearLead({
      setterId: carla.setterId,
      cuentaId: carla.cuentas[1],
      estado: 'respondido',
      envios: [{ tipo: 'primero', diasAtras: 2 }],
      segundoEnHoras: null,
      respondidoHaceHoras: 3 + i * 7,
    })
  }
  await crearLead({
    setterId: carla.setterId,
    cuentaId: carla.cuentas[0],
    estado: 'respondido',
    envios: [{ tipo: 'primero', diasAtras: 5 }],
    segundoEnHoras: null,
    respondidoHaceHoras: 100,
    reunionEnHoras: 8,
  })
  for (let i = 0; i < 2; i++) {
    await crearLead({
      setterId: carla.setterId,
      cuentaId: carla.cuentas[0],
      estado: 'respondido',
      envios: [{ tipo: 'primero', diasAtras: 12 }],
      segundoEnHoras: null,
      respondidoHaceHoras: 260,
      cerrado: true,
    })
  }

  await pool.query(
    `update setters set cuenta_activa_id = $1 where id = $2`,
    [carla.cuentas[1], carla.setterId],
  )

  /* ── Diego: un lead de verdad ────────────────────────────────────────
     Es el único de toda la demo con un usuario de Instagram que existe. Está
     para poder grabar el sistema andando: "Abrir Instagram" abre un perfil
     real en vez de rebotar en un 404, y desde ahí se puede mostrar el recorrido
     entero —abrir, marcar enviado, día completado, pedir más leads— porque
     Diego no tiene nada más en la cola.                                   */

  const diego = ids['diego@demo.local']!

  /*
   * Los únicos leads de toda la demo con un usuario de Instagram que existe.
   * Van con el vencimiento más corto para que queden arriba de todo en la cola
   * —se ordena por el que vence antes— y así "Abrir Instagram" abre un perfil
   * real desde el primer toque.
   */
  const LEADS_REALES = [
    { negocio: 'Salva Mosca', usuario: 'salvamosca', rubro: 'consultoría', ciudad: 'Catamarca' },
    { negocio: 'Nacho Cano', usuario: 'nachocano', rubro: 'consultoría', ciudad: 'Catamarca' },
  ]

  for (const [i, real] of LEADS_REALES.entries()) {
    await crearLead({ setterId: diego.setterId, horasParaVencer: 44 + i, real })
  }

  /* ── Diego: el resto del día, inventado ──────────────────────────────
     El lead real va primero en la cola —vence antes que todos— y detrás tiene
     una tanda normal para que la pantalla no se vea vacía al grabar. Más
     abajo, un lead en cada etapa del recorrido, así se puede mostrar el
     pipeline entero desde su cuenta: contactado, contestó, oferta enviada,
     contestó la oferta, y una reunión agendada.                          */

  for (let i = 0; i < 14; i++) {
    await crearLead({ setterId: diego.setterId, horasParaVencer: 46 + i * 2 })
  }

  // Contactados hoy, esperando respuesta.
  for (let i = 0; i < 4; i++) {
    await crearLead({
      setterId: diego.setterId,
      cuentaId: diego.cuentas[0],
      estado: 'contactado',
      envios: [{ tipo: 'primero', diasAtras: 0 }],
      segundoEnHoras: 20 - i * 3,
    })
  }

  // Contestó la entrada: le falta la oferta, que es el botón que sigue.
  for (let i = 0; i < 2; i++) {
    await crearLead({
      setterId: diego.setterId,
      cuentaId: diego.cuentas[0],
      estado: 'respondido',
      envios: [{ tipo: 'primero', diasAtras: 1 }],
      segundoEnHoras: null,
      respondidoHaceHoras: 3 + i * 4,
    })
  }

  // Ya recibieron la oferta y todavía no dijeron nada.
  for (let i = 0; i < 2; i++) {
    await crearLead({
      setterId: diego.setterId,
      cuentaId: diego.cuentas[0],
      estado: 'segundo_enviado',
      envios: [
        { tipo: 'primero', diasAtras: 3 },
        { tipo: 'segundo', diasAtras: 1 },
      ],
      segundoEnHoras: null,
    })
  }

  // Una reunión agendada, para que su ficha no cierre en cero.
  await crearLead({
    setterId: diego.setterId,
    cuentaId: diego.cuentas[0],
    estado: 'respondido',
    envios: [
      { tipo: 'primero', diasAtras: 4 },
      { tipo: 'segundo', diasAtras: 2 },
    ],
    segundoEnHoras: null,
    respondidoHaceHoras: 20,
    reunionEnHoras: 30,
    nota: 'Le interesa la web con el sistema de turnos. Quiere ver precios el jueves.',
  })

  /* ── Basura de la lista scrapeada y leads que volvieron al pozo ──────── */

  for (let i = 0; i < 3; i++) {
    await crearLead({
      setterId: bruno.setterId,
      estado: 'cuenta_inexistente',
      motivo: 'El perfil de Instagram no existe.',
    })
  }
  for (let i = 0; i < 4; i++) {
    await crearLead({
      setterId: bruno.setterId,
      estado: 'vencido',
      horasParaVencer: -3,
      motivo: 'Pasaron las horas sin trabajarlo y volvió al pozo.',
    })
  }

  /* ── El pozo: lo que queda sin dueño ─────────────────────────────────── */

  for (let i = 0; i < 140; i++) await crearLead({})

  /* ── Respuestas a la oferta ─────────────────────────────────────────
     Un puñado de los que respondieron ya había recibido el segundo mensaje,
     así que su respuesta es un sí o un no a lo que ofrecemos. */

  /* ── El próximo seguimiento de cada lead ─────────────────────────────── */

  // Los que esperan la oferta.
  await pool.query(
    `update lead_assignments
        set proximo_paso = 2, proximo_seguimiento_at = segundo_programado_at
      where estado = 'contactado' and segundo_programado_at is not null`,
  )
  // Los que recibieron los dos y siguen callados: les toca el último intento.
  await pool.query(
    `update lead_assignments
        set proximo_paso = 3,
            proximo_seguimiento_at = coalesce(segundo_mensaje_at, now()) + interval '3 days'
      where estado = 'segundo_enviado' and respondido_at is null`,
  )

  await pool.query(
    `update lead_assignments set respondio_a = 'primero'
      where respondido_at is not null and respondio_a is null`,
  )
  await pool.query(
    `update lead_assignments la
        set respondio_a = 'segundo', interes = 'interesa'
       from (select id from lead_assignments
              where respondido_at is not null
              order by respondido_at desc limit 4) e
      where la.id = e.id`,
  )
  await pool.query(
    `update lead_assignments la
        set respondio_a = 'segundo', interes = 'no_interesa'
       from (select id from lead_assignments
              where respondido_at is not null and respondio_a = 'primero'
              order by respondido_at asc limit 3) e
      where la.id = e.id`,
  )

  /* Al contestar la oferta el setter tiene que anotar qué dijeron: es
     obligatorio en la app, así que en la demo tampoco puede faltar. */
  const DIJERON = [
    'Le interesa pero quiere arrancar el mes que viene.',
    'Preguntó si hacemos prueba de un mes antes de firmar.',
    'Le gustó, pide ver ejemplos del rubro antes de decidir.',
    'Dice que ahora está con poco presupuesto, retomar en marzo.',
    'Ya trabaja con alguien, quedó en avisar si se libera.',
    'No le interesa, dice que no usa redes para el negocio.',
    'Dijo que no, atiende solo por local.',
  ]
  const conOferta = await pool.query<{ id: string }>(
    `select id from lead_assignments where respondio_a = 'segundo' order by respondido_at desc`,
  )
  for (const [i, fila] of conOferta.rows.entries()) {
    await pool.query(`update lead_assignments set nota = $1 where id = $2`, [
      DIJERON[i % DIJERON.length],
      fila.id,
    ])
  }

  /*
   * Al que contestó la entrada le toca la oferta, y le toca ya: recién ahí se
   * entera de a qué nos dedicamos. Al que contestó la oferta y le interesó le
   * toca el reenganche, por si se enfría. Un "no me interesa" no encadena nada.
   */
  await pool.query(
    `update lead_assignments
        set proximo_paso = 2, proximo_seguimiento_at = respondido_at
      where respondido_at is not null and respondio_a = 'primero'
        and estado <> 'segundo_enviado'`,
  )
  await pool.query(
    `update lead_assignments
        set proximo_paso = 5, proximo_seguimiento_at = respondido_at + interval '5 days'
      where respondido_at is not null and respondio_a = 'segundo'
        and interes is distinct from 'no_interesa'`,
  )
  await pool.query(
    `update lead_assignments
        set proximo_paso = null, proximo_seguimiento_at = null
      where interes = 'no_interesa'`,
  )

  /* ── Seguimientos atrasados de las cuatro situaciones ────────────────
     Sin esto el control de seguimientos solo mostraría la oferta, y no se
     vería lo que sirve: en cuál de los cuatro mensajes se traba el equipo. */

  // Último intento (paso 3): recibieron los dos y nunca dijeron nada.
  await pool.query(
    `update lead_assignments la
        set proximo_seguimiento_at = now() - (interval '1 day' * (1 + (row_number) % 4))
       from (select id, row_number() over (order by segundo_mensaje_at) as row_number
               from lead_assignments
              where proximo_paso = 3 and respondido_at is null
              limit 9) e
      where la.id = e.id`,
  )

  /* Contestó y se enfrió (paso 4): abrieron conversación, les mandamos la
     oferta y se callaron. Es el reenganche que más duele dejar pasar. */
  await pool.query(
    `update lead_assignments la
        set respondio_a = 'primero', respondido_at = now() - interval '6 days',
            proximo_paso = 4, proximo_seguimiento_at = now() - (interval '1 day' * (1 + (row_number) % 3))
       from (select id, row_number() over (order by segundo_mensaje_at desc) as row_number
               from lead_assignments
              where estado = 'segundo_enviado' and respondido_at is null
              limit 4) e
      where la.id = e.id`,
  )

  // Le interesó y se enfrió (paso 5): dijeron que sí y desaparecieron.
  await pool.query(
    `update lead_assignments la
        set proximo_seguimiento_at = now() - interval '2 days'
       from (select id from lead_assignments
              where proximo_paso = 5 order by respondido_at desc limit 2) e
      where la.id = e.id`,
  )

  /* ── Diego arranca el día limpio ─────────────────────────────────────
     Su cola es la que se graba, así que no puede abrir con seguimientos
     atrasados: los seguimientos van siempre primero y taparían al lead real.
     Sus leads conservan la etapa en la que están —contactado, contestó,
     oferta enviada— para que "Mis leads" muestre el recorrido entero, pero lo
     que les toca queda programado para más adelante.                     */

  await pool.query(
    `update lead_assignments
        set proximo_seguimiento_at = now() + interval '20 hours'
      where setter_id = $1
        and proximo_seguimiento_at is not null
        and proximo_seguimiento_at <= now()`,
    [diego.setterId],
  )

  /* ── El registro de actividad ────────────────────────────────────────
     La demo escribe los leads directo con SQL, así que no pasa por las
     acciones y no deja rastro. Acá se reconstruye: un evento por cada envío
     que ya existe, más las respuestas y las reuniones. Sin esto la pantalla de
     Actividad se ve vacía aunque el equipo "trabajó" todo el día.         */

  await pool.query(
    `insert into events (type, contact_id, actor_user_id, created_at, payload_jsonb)
     select case when ss.paso = 1 then 'lead_contactado' else 'lead_segundo_enviado' end,
            ss.contact_id, u.id, ss.sent_at,
            jsonb_build_object('cuenta', sa.ig_username, 'cupo', sa.cupo_diario)
       from setter_sends ss
       join setters s on s.id = ss.setter_id
       join users u on u.id = s.user_id
       left join setter_accounts sa on sa.id = ss.setter_account_id
      where ss.undone_at is null`,
  )

  await pool.query(
    `insert into events (type, contact_id, actor_user_id, created_at, payload_jsonb)
     select 'lead_respondio', la.contact_id, u.id, la.respondido_at,
            jsonb_build_object('respondioA', la.respondio_a, 'interes', la.interes,
                               'nota', la.nota)
       from lead_assignments la
       join setters s on s.id = la.setter_id
       join users u on u.id = s.user_id
      where la.respondido_at is not null`,
  )

  await pool.query(
    `insert into events (type, contact_id, actor_user_id, created_at, payload_jsonb)
     select 'reunion_agendada', m.contact_id, u.id, m.created_at, '{}'::jsonb
       from meetings m
       join setters s on s.id = m.setter_id
       join users u on u.id = s.user_id`,
  )

  await pool.query(
    `insert into events (type, actor_user_id, created_at, payload_jsonb)
     select 'ingreso', u.id, now() - (random() * interval '9 hours'), '{}'::jsonb
       from users u where u.role = 'setter'`,
  )

  /* ── Mensajes al equipo ──────────────────────────────────────────────── */

  const aviso = await pool.query<{ id: string }>(
    `insert into mensajes_equipo (nivel, titulo, cuerpo, fijado, created_at)
     values ('aviso', 'Horarios de esta semana',
             'Trabajamos de 9 a 13 y de 17 a 20. El sábado solo a la mañana.',
             true, now() - interval '2 days')
     returning id`,
  )
  const bloqueante = await pool.query<{ id: string }>(
    `insert into mensajes_equipo (nivel, titulo, cuerpo, texto_para_copiar, created_at)
     values ('bloqueante', 'Cambiamos el mensaje de apertura',
             'Desde hoy usen el texto de abajo. No manden más el anterior: el viejo tenía el precio y nos estaba trayendo gente que solo preguntaba eso.',
             'Hola! Vi lo que hacen en {{negocio}} y me quedó una duda, ¿te puedo preguntar algo?',
             now() - interval '30 hours')
     returning id`,
  )

  for (const s of [abril, bruno, carla]) {
    await pool.query(
      `insert into mensajes_destinatarios (mensaje_id, setter_id, leido_at)
       values ($1, $2, case when $3 then now() - interval '1 day' else null end)`,
      [aviso.rows[0]!.id, s.setterId, s.setterId !== bruno.setterId],
    )
  }
  await pool.query(
    `insert into mensajes_destinatarios (mensaje_id, setter_id) values ($1, $2)`,
    [bloqueante.rows[0]!.id, bruno.setterId],
  )
  await pool.query(
    `insert into mensajes_destinatarios (mensaje_id, setter_id, leido_at, respuesta, respondido_at)
     values ($1, $2, now() - interval '20 hours', 'Listo, ya lo cambié. Igual la cuenta B me pide verificación.', now() - interval '19 hours')`,
    [bloqueante.rows[0]!.id, abril.setterId],
  )

  /* ── Recordatorios que ya le mandé a Bruno ───────────────────────────── */

  await pool.query(
    `insert into recordatorios (setter_id, tipo, automatico, pendientes, atrasados, dias_atraso,
                                texto, visto_at, created_at)
     values ($1, 'seguimientos', false, 15, 15, 1,
             'Te quedan 15 seguimientos pendientes, 15 con 1 día de atraso.',
             now() - interval '23 hours', now() - interval '1 day')`,
    [bruno.setterId],
  )
  await pool.query(
    `insert into recordatorios (setter_id, tipo, automatico, pendientes, atrasados, dias_atraso,
                                texto, created_at)
     values ($1, 'seguimientos', true, 15, 15, 2,
             'Te quedan 15 seguimientos pendientes, 15 con 2 días de atraso.',
             now() - interval '3 hours')`,
    [bruno.setterId],
  )

  /* ── La campana ──────────────────────────────────────────────────────── */

  const avisos: Array<[string, string, string, string | null, number]> = [
    ['respondio', 'Abril marcó que Estilo Quiroga contestó · "Preguntó cuánto sale."', '/respondieron', abril.setterId, 12],
    ['reunion_agendada', 'Carla agendó reunión con Don Molina para mañana 10:00', '/reuniones', carla.setterId, 95],
    ['seguimientos_atrasados', 'Bruno acumula 2 días de atraso en sus seguimientos', '/equipo/seguimientos', bruno.setterId, 180],
    ['leads_por_vencer', '4 leads de Bruno vencen en 6 horas', '/equipo/leads?ver=sin_contactar', bruno.setterId, 240],
    ['respuesta_de_setter', 'Abril respondió: "Listo, ya lo cambié. Igual la cuenta B me pide verificación."', '/equipo/avisos', abril.setterId, 1140],
  ]
  for (const [tipo, texto, enlace, setterId, minutos] of avisos) {
    await pool.query(
      `insert into notificaciones (tipo, texto, enlace, setter_id, leida, created_at)
       values ($1::notificacion_tipo, $2, $3, $4, false, now() - ($5 || ' minutes')::interval)`,
      [tipo, texto, enlace, setterId, String(minutos)],
    )
  }

  const pozo = await pool.query<{ n: string }>(
    `select count(*) as n from contacts c
      where c.origen = 'scrapeado' and c.discarded_at is null and c.stage in ('nuevo','encolado')
        and not exists (select 1 from lead_assignments la
                         where la.contact_id = c.id and la.estado not in ('vencido','devuelto'))`,
  )

  console.log(`
Equipo de demostración listo. Todo inventado.

  Abril Quiroga   2 cuentas · la primera al tope, ya cambió a la segunda
                  5 seguimientos sin hacer · 6 respuestas esperando · 2 reuniones
  Bruno Herrera   no arrancó hoy · 15 seguimientos con 2 días de atraso
                  tiene un mensaje BLOQUEANTE sin leer
  Carla Vega      terminó el día: las dos cuentas al tope, seguimientos al día
  Diego Sosa      16 leads sin contactar; los dos primeros son REALES:
                  @salvamosca y @nachocano
                  4 contactados · 2 esperando la oferta · 1 reunión

  ${pozo.rows[0]!.n} leads sin asignar en el pozo
  5 avisos sin leer en la campana

Entran en /ingresar con:
${SETTERS_DEMO.map((s) => `  ${s.email}`).join('\n')}
  contraseña: ${CLAVE_DEMO}
`)
}

/* ── Entrada ──────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL.')
  const accion =
    process.argv[2] === '--limpiar'
      ? limpiar
      : process.argv[2] === '--historial'
        ? limpiarHistorial
        : process.argv[2] === '--setters'
          ? cargarSetters
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

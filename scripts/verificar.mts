import './load-env'

import { Pool } from 'pg'

/**
 * Verificación de punta a punta contra el servidor de desarrollo.
 *
 *   npm run dev            (en otra terminal)
 *   npm run verificar
 *
 * Hace dos cosas que los tests de unidad no pueden hacer:
 *
 *   1. **Abre cada pantalla de verdad**, con una sesión real y contra la base
 *      real. Un componente de servidor que revienta al renderizar no lo agarra
 *      ningún test: compila bien, pasa el lint, y falla recién cuando alguien
 *      entra. Esto entra a todas.
 *
 *   2. **Comprueba que lo que se toca en la pantalla queda guardado.** Cada
 *      acción se dispara y después se mira la base para ver si el dato está.
 *      Que la pantalla diga "listo" no prueba nada.
 *
 * No es un test automatizado más: es la lista de control antes de desplegar.
 */

const BASE = process.env.VERIFICAR_URL ?? 'http://localhost:3000'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

let fallas = 0
let pasadas = 0

function bien(que: string, detalle = ''): void {
  pasadas++
  console.log(`  ok    ${que}${detalle ? `  ${detalle}` : ''}`)
}

function mal(que: string, porque: string): void {
  fallas++
  console.log(`  FALLA ${que}\n        ${porque}`)
}

/* ── Sesión ───────────────────────────────────────────────────────────── */

/**
 * Entra como una cuenta de demostración y devuelve sus cookies.
 *
 * Usa la pasarela sin contraseña, que solo existe en desarrollo. Es el mismo
 * camino que usa el botón de acceso rápido de `/ingresar`.
 */
async function entrar(email: string): Promise<string> {
  const galleta = new Map<string, string>()

  const guardar = (r: Response): void => {
    for (const linea of r.headers.getSetCookie()) {
      const [par] = linea.split(';')
      const [nombre, ...resto] = par!.split('=')
      galleta.set(nombre!.trim(), resto.join('='))
    }
  }
  const enviar = (): string =>
    [...galleta.entries()].map(([k, v]) => `${k}=${v}`).join('; ')

  const csrf = await fetch(`${BASE}/api/auth/csrf`)
  guardar(csrf)
  const { csrfToken } = (await csrf.json()) as { csrfToken: string }

  const r = await fetch(`${BASE}/api/auth/callback/prueba`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: enviar() },
    body: new URLSearchParams({ email, csrfToken, callbackUrl: BASE }),
    redirect: 'manual',
  })
  guardar(r)

  const cookies = enviar()
  if (!cookies.includes('authjs.session-token') && !cookies.includes('next-auth.session-token')) {
    throw new Error(`No se pudo entrar como ${email}. ¿Está MODO_PRUEBA=true y corriendo el dev?`)
  }
  return cookies
}

/* ── Pantallas ────────────────────────────────────────────────────────── */

/**
 * Abre una ruta y falla si no responde 200 o si Next dibujó su pantalla de
 * error. Un 500 devuelve HTML igual, así que el código de estado solo no
 * alcanza para saber si la pantalla anda.
 */
async function abrir(cookies: string, ruta: string, espera = 200): Promise<void> {
  const r = await fetch(`${BASE}${ruta}`, { headers: { cookie: cookies }, redirect: 'manual' })
  const cuerpo = r.status === 200 ? await r.text() : ''

  if (r.status !== espera) {
    mal(ruta, `respondió ${r.status}, se esperaba ${espera}`)
    return
  }
  if (cuerpo.includes('Application error') || cuerpo.includes('__next_error__')) {
    mal(ruta, 'la pantalla se rompió al renderizar')
    return
  }
  bien(ruta)
}

async function uno<T>(consulta: string, valores: unknown[] = []): Promise<T | undefined> {
  const r = await pool.query(consulta, valores)
  return r.rows[0] as T | undefined
}

/* ── El recorrido ─────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  console.log(`\nVerificando ${BASE}\n`)

  /* ── 1. Las pantallas del panel ─────────────────────────────────────── */
  console.log('Panel del administrador')
  const admin = await entrar('admin@demo.local')

  const setter = await uno<{ id: string; user_id: string; email: string }>(
    `select s.id, u.id as user_id, u.email from setters s
       join users u on u.id = s.user_id where u.email = 'diego@demo.local'`,
  )
  if (!setter) throw new Error('Falta el equipo de demostración. Corré: npm run demo:setters')

  for (const ruta of [
    '/equipo',
    '/equipo/avisos',
    '/equipo/leads',
    '/equipo/seguimientos',
    `/equipo/seguimientos/${setter.id}`,
    `/equipo/${setter.id}`,
    '/respondieron',
    `/respondieron/${setter.id}`,
    '/reuniones',
    '/contactos',
    '/importar',
    '/configuracion',
    '/configuracion/referencias',
    '/actividad',
  ]) {
    await abrir(admin, ruta)
  }

  // Las clasificaciones que se abren al tocar un número.
  console.log('\n  Listas que se abren al tocar un número')
  for (const v of ['por_contactar', 'contactados', 'seguimiento_hecho', 'falta_seguimiento',
                   'atrasados', 'contestaron', 'listos']) {
    await abrir(admin, `/equipo/seguimientos?ver=${v}`)
  }
  for (const v of ['sin_clasificar', 'sin_oferta', 'oferta', 'interesados', 'no_interesa']) {
    await abrir(admin, `/respondieron?ver=${v}`)
  }
  for (const g of ['mensajes', 'respuestas', 'leads', 'equipo']) {
    await abrir(admin, `/actividad?grupo=${g}`)
  }

  /* ── 2. Las pantallas del setter ────────────────────────────────────── */
  console.log('\nApp del setter')
  const diego = await entrar('diego@demo.local')
  for (const ruta of ['/hoy', '/mis-leads', '/referencias', '/avisos']) {
    await abrir(diego, ruta)
  }
  for (const p of ['contactados', 'respondio_primero', 'oferta_enviada', 'respondio_oferta',
                   'reuniones']) {
    await abrir(diego, `/mis-leads?ver=${p}`)
  }

  /* ── 3. Que el portero siga cerrado ─────────────────────────────────── */
  console.log('\nPermisos')
  // Un setter en el panel rebota; un admin en la app del setter, también.
  const r1 = await fetch(`${BASE}/equipo`, { headers: { cookie: diego }, redirect: 'manual' })
  if (r1.status === 307 || r1.status === 302) bien('/equipo con sesión de setter', '→ redirige')
  else mal('/equipo con sesión de setter', `respondió ${r1.status}, tendría que redirigir`)

  const r2 = await fetch(`${BASE}/hoy`, { headers: { cookie: admin }, redirect: 'manual' })
  if (r2.status === 307 || r2.status === 302) bien('/hoy con sesión de admin', '→ redirige')
  else mal('/hoy con sesión de admin', `respondió ${r2.status}, tendría que redirigir`)

  // Dar de alta a alguien es de la cuenta madre y de nadie más: un admin
  // común tiene que rebotar igual que un setter.
  const rMadre = await fetch(`${BASE}/equipo/nuevo`, { headers: { cookie: admin }, redirect: 'manual' })
  if (rMadre.status === 307 || rMadre.status === 302) bien('/equipo/nuevo con admin común', '→ redirige')
  else mal('/equipo/nuevo con admin común', `respondió ${rMadre.status}, solo la cuenta madre entra`)

  const r3 = await fetch(`${BASE}/equipo`, { redirect: 'manual' })
  if (r3.status !== 200) bien('/equipo sin sesión', '→ no entra')
  else mal('/equipo sin sesión', 'devolvió la pantalla sin pedir sesión')

  /* ── 4. Salud ───────────────────────────────────────────────────────── */
  const salud = await fetch(`${BASE}/api/salud`)
  if (salud.ok) bien('/api/salud', '→ 200')
  else mal('/api/salud', `respondió ${salud.status}`)

  /* ── 5. Que lo que se toca quede guardado ───────────────────────────── */
  await verificarEscrituras(diego, admin, setter.id)

  console.log(`\n${pasadas} bien · ${fallas} mal\n`)
  if (fallas > 0) process.exitCode = 1
}

/**
 * Las acciones, disparadas como las dispara la pantalla y comprobadas contra
 * la base.
 *
 * Se recorre el camino entero de un lead —abrir, mandar, contestar, ofertar,
 * contestar la oferta, agendar— y después de cada paso se mira la fila. Lo que
 * se prueba no es que la acción devuelva `ok`, sino que el dato esté guardado:
 * son dos cosas distintas y solo la segunda importa.
 *
 * Al final se deshace todo, así el verificador se puede correr las veces que
 * haga falta sin ensuciar la demostración.
 */
async function verificarEscrituras(
  cookiesSetter: string,
  cookiesAdmin: string,
  setterId: string,
): Promise<void> {
  console.log('\nEscrituras: se toca la pantalla, se mira la base')

  // Un lead descartable, para no tocar los de la demostración.
  const contacto = await uno<{ id: string }>(
    `insert into contacts (business_name, ig_username, has_instagram, niche, city,
                           origen, preferred_channel, score, dedupe_key, stage)
     values ('Verificación', $1, true, 'consultoría', 'Catamarca', 'scrapeado',
             'instagram', 50, $2, 'nuevo')
     returning id`,
    [`verificacion${Date.now()}`, `ig:verificacion${Date.now()}`],
  )
  const asignacion = await uno<{ id: string }>(
    `insert into lead_assignments (contact_id, setter_id, estado, asignado_at, vence_at)
     values ($1, $2, 'asignado', now(), now() + interval '40 hours')
     returning id`,
    [contacto!.id, setterId],
  )
  const id = asignacion!.id

  const accion = async (nombre: string, datos: unknown[]): Promise<unknown> => {
    const r = await fetch(`${BASE}/mis-leads`, {
      method: 'POST',
      headers: {
        cookie: cookiesSetter,
        'content-type': 'text/plain;charset=UTF-8',
        'next-action': nombre,
      },
      body: JSON.stringify(datos),
    })
    return r.text()
  }

  try {
    /* Abrir el chat deja la hora registrada. */
    await accion(await idDeAccion('abrirChat'), [id])
    const abierto = await uno<{ abierto_at: Date | null; estado: string }>(
      `select abierto_at, estado from lead_assignments where id = $1`,
      [id],
    )
    if (abierto?.abierto_at) bien('abrir el chat', `→ estado ${abierto.estado}`)
    else mal('abrir el chat', 'no quedó registrada la hora de apertura')

    /* Marcar enviado consume cupo y programa lo que sigue. */
    await accion(await idDeAccion('marcarEnviado'), [id])
    const enviado = await uno<{ estado: string; paso: number | null; envios: number }>(
      `select la.estado, la.proximo_paso as paso,
              (select count(*)::int from setter_sends ss
                where ss.assignment_id = la.id and ss.undone_at is null) as envios
         from lead_assignments la where la.id = $1`,
      [id],
    )
    if (enviado?.estado === 'contactado' && enviado.envios === 1 && enviado.paso === 2) {
      bien('marcar enviado', '→ contactado, 1 envío, le toca la oferta')
    } else {
      mal('marcar enviado', `quedó ${JSON.stringify(enviado)}`)
    }

    /* Contestó la entrada: sin nota, y la oferta queda lista ya. */
    await accion(await idDeAccion('marcarRespondio'), [id, {}])
    const contesto = await uno<{ estado: string; a: string | null; paso: number | null }>(
      `select estado, respondio_a as a, proximo_paso as paso
         from lead_assignments where id = $1`,
      [id],
    )
    if (contesto?.estado === 'respondido' && contesto.a === 'primero' && contesto.paso === 2) {
      bien('contestó el 1er mensaje', '→ le toca la oferta, ya mismo')
    } else {
      mal('contestó el 1er mensaje', `quedó ${JSON.stringify(contesto)}`)
    }

    /* La oferta sale sobre un lead que ya respondió. */
    await accion(await idDeAccion('marcarEnviado'), [id])
    const oferta = await uno<{ estado: string; paso: number | null; envios: number }>(
      `select la.estado, la.proximo_paso as paso,
              (select count(*)::int from setter_sends ss
                where ss.assignment_id = la.id and ss.undone_at is null) as envios
         from lead_assignments la where la.id = $1`,
      [id],
    )
    if (oferta?.estado === 'segundo_enviado' && oferta.envios === 2 && oferta.paso === 4) {
      bien('enviar la oferta', '→ 2 envíos, después le toca el reenganche')
    } else {
      mal('enviar la oferta', `quedó ${JSON.stringify(oferta)}`)
    }

    /* Contestar la oferta SIN nota tiene que ser rechazado. */
    await accion(await idDeAccion('marcarRespondio'), [id, { interes: 'interesa' }])
    const sinNota = await uno<{ interes: string | null }>(
      `select interes from lead_assignments where id = $1`,
      [id],
    )
    if (!sinNota?.interes) bien('contestar la oferta sin nota', '→ rechazado, como debe ser')
    else mal('contestar la oferta sin nota', 'se guardó igual, la nota tenía que ser obligatoria')

    /* Con nota, sí. */
    await accion(await idDeAccion('marcarRespondio'), [
      id,
      { interes: 'interesa', nota: 'Quiere la web con turnos.' },
    ])
    const conNota = await uno<{ interes: string | null; nota: string | null; a: string | null }>(
      `select interes, nota, respondio_a as a from lead_assignments where id = $1`,
      [id],
    )
    if (conNota?.interes === 'interesa' && conNota.nota && conNota.a === 'segundo') {
      bien('contestar la oferta con nota', `→ "${conNota.nota}"`)
    } else {
      mal('contestar la oferta con nota', `quedó ${JSON.stringify(conNota)}`)
    }

    /*
     * Y ahora lo que de verdad importa: que eso aparezca en el panel.
     *
     * Que la fila esté en la base no alcanza. La pregunta es si el admin lo ve
     * —en la bandeja correcta, con la etiqueta correcta y con lo que anotó el
     * setter— porque si no lo ve, para él no pasó.
     */
    await enElPanel(
      cookiesAdmin,
      '/respondieron?ver=interesados',
      ['Verificaci', 'Quiere la web con turnos'],
      'la respuesta llega a Respondieron',
    )
    await enElPanel(
      cookiesAdmin,
      '/actividad?q=verificacion',
      ['Verificaci', 'Contest'],
      'la respuesta llega a Actividad',
    )
    await enElPanel(
      cookiesAdmin,
      '/equipo/seguimientos?ver=contestaron',
      ['Verificaci'],
      'la respuesta llega a Seguimientos',
    )

    /* Agendar una reunión. */
    const manana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    await accion(await idDeAccion('agendarReunion'), [
      id,
      { fecha: manana, hora: '10:00', tipo: 'llamada' },
    ])
    const reunion = await uno<{ n: number }>(
      `select count(*)::int as n from meetings where contact_id = $1`,
      [contacto!.id],
    )
    if (reunion?.n === 1) bien('agendar reunión', '→ guardada')
    else mal('agendar reunión', `hay ${reunion?.n} reuniones, tendría que haber 1`)

    await enElPanel(cookiesAdmin, '/reuniones', ['Verificaci'], 'la reunión llega a Reuniones')

    /* El registro de actividad tiene que haber anotado todo esto. */
    const rastro = await uno<{ n: number }>(
      `select count(*)::int as n from events where contact_id = $1`,
      [contacto!.id],
    )
    if ((rastro?.n ?? 0) >= 4) bien('quedó rastro en Actividad', `→ ${rastro!.n} eventos`)
    else mal('quedó rastro en Actividad', `solo ${rastro?.n} eventos para todo el recorrido`)

    /* Referencias: alta desde el panel y lectura desde el celular. */
    const pregunta = `¿Verificación ${Date.now()}?`
    await fetch(`${BASE}/configuracion/referencias`, {
      method: 'POST',
      headers: {
        cookie: cookiesAdmin,
        'content-type': 'text/plain;charset=UTF-8',
        'next-action': await idDeAccion('guardarReferencia'),
      },
      body: JSON.stringify([
        { categoria: 'otras', pregunta, respuesta: 'Sí, anda.', activa: true },
      ]),
    })
    const ref = await uno<{ id: string }>(
      `select id from referencias where pregunta = $1`,
      [pregunta],
    )
    if (ref) {
      bien('crear una referencia', '→ guardada')
      const enElCelular = await fetch(`${BASE}/referencias`, { headers: { cookie: cookiesSetter } })
      const html = await enElCelular.text()
      if (html.includes('Sí, anda.')) bien('la referencia le llega al setter', '→ la ve en su celular')
      else mal('la referencia le llega al setter', 'no aparece en /referencias')
      await pool.query(`delete from referencias where id = $1`, [ref.id])
    } else {
      mal('crear una referencia', 'no quedó guardada')
    }
    /* ── El resto de los botones que escriben ────────────────────────── */

    /* Saltear: vuelve mañana, no se pierde. */
    const otro = await leadDePrueba(setterId, 'Salteo')
    await accion(await idDeAccion('saltearLead'), [otro.asignacion])
    const salteado = await uno<{ estado: string; pospuesto: Date | null }>(
      `select estado, pospuesto_at as pospuesto from lead_assignments where id = $1`,
      [otro.asignacion],
    )
    if (salteado?.estado === 'saltado' && salteado.pospuesto) bien('saltear', '→ queda pospuesto')
    else mal('saltear', `quedó ${JSON.stringify(salteado)}`)

    /* Cuenta inexistente: sale de circulación y no se lo lleva otro mañana. */
    await accion(await idDeAccion('marcarCuentaInexistente'), [otro.asignacion])
    const inexistente = await uno<{ estado: string; etapa: string; descartado: Date | null }>(
      `select la.estado, c.stage as etapa, c.discarded_at as descartado
         from lead_assignments la join contacts c on c.id = la.contact_id
        where la.id = $1`,
      [otro.asignacion],
    )
    if (
      inexistente?.estado === 'cuenta_inexistente' &&
      inexistente.etapa === 'descartado' &&
      inexistente.descartado
    ) {
      bien('marcar cuenta inexistente', '→ descartado, fuera del pozo')
    } else {
      mal('marcar cuenta inexistente', `quedó ${JSON.stringify(inexistente)}`)
    }
    await pool.query(`delete from contacts where id = $1`, [otro.contacto])

    /* Deshacer: libera el cupo sin borrar el rastro. */
    const tercero = await leadDePrueba(setterId, 'Deshacer')
    await accion(await idDeAccion('abrirChat'), [tercero.asignacion])
    await accion(await idDeAccion('marcarEnviado'), [tercero.asignacion])
    const envio = await uno<{ id: string }>(
      `select id from setter_sends where assignment_id = $1 and undone_at is null`,
      [tercero.asignacion],
    )
    if (envio) {
      await accion(await idDeAccion('deshacerMarca'), [envio.id])
      const deshecho = await uno<{ sellado: Date | null; estado: string; vivos: number }>(
        `select ss.undone_at as sellado, la.estado,
                (select count(*)::int from setter_sends x
                  where x.assignment_id = la.id and x.undone_at is null) as vivos
           from setter_sends ss join lead_assignments la on la.id = ss.assignment_id
          where ss.id = $1`,
        [envio.id],
      )
      if (deshecho?.sellado && deshecho.vivos === 0 && deshecho.estado === 'abierto') {
        bien('deshacer un envío', '→ el cupo se libera y la fila queda sellada, no borrada')
      } else {
        mal('deshacer un envío', `quedó ${JSON.stringify(deshecho)}`)
      }
    } else {
      mal('deshacer un envío', 'no se pudo registrar el envío previo')
    }
    await pool.query(`delete from contacts where id = $1`, [tercero.contacto])

    /* Clasificar desde el panel: es el botón que más se toca en el día. */
    const cuarto = await leadDePrueba(setterId, 'Clasificar')
    await pool.query(`update contacts set stage = 'respondido', received_count = 1 where id = $1`, [
      cuarto.contacto,
    ])
    await fetch(`${BASE}/respondieron`, {
      method: 'POST',
      headers: {
        cookie: cookiesAdmin,
        'content-type': 'text/plain;charset=UTF-8',
        'next-action': await idDeAccion('clasificar'),
      },
      body: JSON.stringify([cuarto.contacto, 'interesado']),
    })
    const clasificado = await uno<{ etapa: string }>(
      `select stage as etapa from contacts where id = $1`,
      [cuarto.contacto],
    )
    if (clasificado?.etapa === 'interesado') bien('clasificar desde el panel', '→ interesado')
    else mal('clasificar desde el panel', `quedó en ${clasificado?.etapa}`)
    await pool.query(`delete from contacts where id = $1`, [cuarto.contacto])

    /* Reclamarle los seguimientos a alguien deja constancia. */
    const antes = await uno<{ n: number }>(
      `select count(*)::int as n from recordatorios where setter_id = $1`,
      [setterId],
    )
    await fetch(`${BASE}/equipo/seguimientos`, {
      method: 'POST',
      headers: {
        cookie: cookiesAdmin,
        'content-type': 'text/plain;charset=UTF-8',
        'next-action': await idDeAccion('recordar'),
      },
      body: JSON.stringify([setterId, 'seguimientos']),
    })
    const despues = await uno<{ n: number }>(
      `select count(*)::int as n from recordatorios where setter_id = $1`,
      [setterId],
    )
    if ((despues?.n ?? 0) > (antes?.n ?? 0)) {
      bien('reclamar seguimientos', '→ le queda el aviso registrado')
      await pool.query(
        `delete from recordatorios where id in (
           select id from recordatorios where setter_id = $1 order by created_at desc limit 1)`,
        [setterId],
      )
    } else {
      mal('reclamar seguimientos', 'no quedó ningún recordatorio')
    }
  } finally {
    // El lead de prueba se va entero: eventos, envíos, reuniones y contacto.
    await pool.query(`delete from contacts where id = $1`, [contacto!.id])
  }
}

/** Un lead descartable, para no ensuciar los de la demostración. */
async function leadDePrueba(
  setterId: string,
  nombre: string,
): Promise<{ contacto: string; asignacion: string }> {
  const marca = `${nombre.toLowerCase()}${Date.now()}${Math.floor(performance.now())}`
  const c = await uno<{ id: string }>(
    `insert into contacts (business_name, ig_username, has_instagram, niche, city,
                           origen, preferred_channel, score, dedupe_key, stage)
     values ($1, $2, true, 'consultoría', 'Catamarca', 'scrapeado', 'instagram', 50, $3, 'nuevo')
     returning id`,
    [`Verificación ${nombre}`, marca, `ig:${marca}`],
  )
  const a = await uno<{ id: string }>(
    `insert into lead_assignments (contact_id, setter_id, estado, asignado_at, vence_at)
     values ($1, $2, 'asignado', now(), now() + interval '40 hours')
     returning id`,
    [c!.id, setterId],
  )
  return { contacto: c!.id, asignacion: a!.id }
}

/**
 * Abre una pantalla del panel y busca ahí lo que se acaba de guardar.
 *
 * Es la mitad que falta de cada verificación: no alcanza con que el dato esté
 * en la base, tiene que llegar a la pantalla donde alguien lo va a leer. Si se
 * guarda bien y no se muestra, para el que mira el panel no pasó nada.
 */
async function enElPanel(
  cookies: string,
  ruta: string,
  textos: string[],
  que: string,
): Promise<void> {
  const r = await fetch(`${BASE}${ruta}`, { headers: { cookie: cookies } })
  const html = await r.text()
  const falta = textos.filter((t) => !html.includes(t))
  if (falta.length === 0) bien(que, `→ ${ruta}`)
  else mal(que, `en ${ruta} no aparece: ${falta.join(', ')}`)
}

/**
 * El identificador de una acción de servidor.
 *
 * Next no las publica por su nombre sino por un hash que calcula al compilar.
 * El puente está en el propio JavaScript que baja el navegador: ahí queda
 * `createServerReference("<hash>", …, "<nombre>")`, con los dos juntos.
 *
 * Leerlo de ahí es a propósito: es **exactamente** el mismo id que usa el
 * botón real. Si la acción se renombra o se mueve, esto sigue encontrándola;
 * y si deja de existir, falla acá en vez de fallar en silencio.
 */
const manifiesto = new Map<string, string>()

async function idDeAccion(nombre: string): Promise<string> {
  if (manifiesto.size === 0) {
    const { readdir, readFile } = await import('node:fs/promises')
    const raiz = '.next/static/chunks'

    const recorrer = async (dir: string): Promise<string[]> => {
      const entradas = await readdir(dir, { withFileTypes: true })
      const salida: string[] = []
      for (const e of entradas) {
        const ruta = `${dir}/${e.name}`
        if (e.isDirectory()) salida.push(...(await recorrer(ruta)))
        else if (e.name.endsWith('.js')) salida.push(ruta)
      }
      return salida
    }

    const patron = /createServerReference\)\(\\?"([0-9a-f]{40,})\\?"[^)]*?\\?"(\w+)\\?"\)/g
    for (const archivo of await recorrer(raiz)) {
      const texto = await readFile(archivo, 'utf8')
      for (const m of texto.matchAll(patron)) manifiesto.set(m[2]!, m[1]!)
    }
  }

  const id = manifiesto.get(nombre)
  if (!id) {
    throw new Error(
      `No encontré la acción ${nombre} en el build. Corré primero:  npm run build`,
    )
  }
  return id
}

main()
  .catch((e) => {
    console.error('\n', e instanceof Error ? e.message : e, '\n')
    process.exitCode = 1
  })
  .finally(() => pool.end())

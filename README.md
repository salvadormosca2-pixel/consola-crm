# ECOSYSTEM

Captación y seguimiento de clientes por Instagram, y seguimiento de los que ya compraron:
importar la lista, ordenarla, repartirla entre las cuentas emisoras y —a partir
de la parte 2— despachar los mensajes de a uno con un click.

**Estado:** terminadas la fase 1 y la fase 2 de la parte 1 (cimientos e
importador de Excel, con el reparto entre cuentas de la fase 5 incluido) y la
fase 1 de la parte 2 (rotación, calentamiento y contabilidad de cupos).

Ya sirve para lo que pedía el criterio de la parte 1: **cargar y ordenar la base
de clientes**. Se cargan las cuentas emisoras, se importa un Excel de 1.000+
filas con normalización y deduplicación, y los contactos quedan repartidos entre
los números. Todavía falta la tabla de contactos con filtros, las plantillas y
todo el envío.

---

## Arrancar

### 1. Base de datos

La app solo mira `DATABASE_URL`, así que sirve cualquiera de las tres:

**a. Docker** (lo esperable en cualquier máquina con Docker):

```bash
docker compose up -d db redis
```

**b. Postgres portable** (lo que está configurado hoy, porque este equipo no
tiene Docker ni Postgres instalado). Los binarios viven en `.pgdev/`, no hay
nada instalado a nivel sistema y se borra con `Remove-Item .pgdev -Recurse`:

```powershell
.\scripts\pg-local.ps1 init     # una sola vez: crea el cluster y la base
.\scripts\pg-local.ps1 start    # cada vez que prendés la máquina
.\scripts\pg-local.ps1 stop
.\scripts\pg-local.ps1 status
```

**c. Supabase u otro Postgres administrado.** Cambiá `DATABASE_URL` en
`.env.local` y poné `DATABASE_SSL=true`. El esquema es portable: no usa nada
propio de Supabase.

### 2. Entorno

```bash
cp .env.example .env.local
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # → AUTH_SECRET
```

`.env.local` no se versiona. Ninguna de sus variables lleva prefijo
`NEXT_PUBLIC_`: son todas secretos de servidor.

### 3. Migraciones y primer usuario

```bash
npm install
npm run db:migrate
npm run user:create        # pregunta email, nombre y contraseña
npm run dev                # http://localhost:3000
```

La primera cuenta que se crea es la **admin madre**: la que ve todo, la única
que da de alta y de baja gente, y la que la base protege de ser borrada o
degradada. Las siguientes son admins comunes. Los setters no se crean desde
acá: se dan de alta desde el panel, en **Equipo → Nuevo setter**, que además
genera su tarjeta de acceso.

---

## Módulo de setters

Un equipo que contacta leads fríos por DM de Instagram desde el celular. No
cierra ventas: manda el primer mensaje, manda el segundo a las 24 h, y cuando
el lead contesta lo pasa a la bandeja del admin.

### Las dos reglas que no se negocian

Las dos están garantizadas por la base, no por la pantalla:

- **Nunca dos setters al mismo lead.** Un índice único parcial sobre
  `lead_assignments (contact_id)` que solo excluye los estados `vencido` y
  `devuelto`. Dos setters escribiéndole al mismo negocio es exactamente lo que
  hace que parezcas spam.
- **Nunca más de 30 mensajes por cuenta de Instagram por día.** Cada marca
  traba la cuenta (`for update`) y **recuenta** el cupo desde `setter_sends`
  dentro de la transacción. El contador `enviados_hoy` de la ficha es caché de
  presentación, no la autoridad.

Los dos invariantes tienen tests de concurrencia contra Postgres real en
`src/server/setters/setters.test.ts`.

### Cómo empieza a haber leads

El pozo de los setters son los contactos con `origen = 'scrapeado'`. Ese origen
se elige **al importar**: en la pantalla de Importar hay un selector arriba de
todo. Los leads scrapeados no entran nunca a la cola del Despachador, y los
clientes propios no entran nunca al pozo de los setters.

### La app del setter

Es la misma app, en las rutas `/hoy`, `/mis-leads` y `/avisos`. Se instala como
PWA desde el link: `manifest.webmanifest`, `sw.js` y los íconos se sirven sin
sesión para que el navegador ofrezca instalarla.

El envío es **semi-automático a propósito**: no existe forma de precargar el
texto de un DM de Instagram, así que el mensaje va al portapapeles y se abre
`ig.me/m/usuario`. No se automatiza con librerías no oficiales ni con
automatización de navegador.

Si el setter marca "Enviado" sin señal, la marca se guarda en el celular
(`localStorage`) y se sincroniza sola al volver la conexión. Reintentar es
gratis: el índice único `(assignment_id, tipo)` absorbe la marca repetida sin
consumir cupo de nuevo.

### Notificaciones push (opcional)

```bash
npm run push:claves     # imprime VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY
```

Sin esas claves el push queda apagado y **el botón de activar avisos no
aparece**. Todo lo demás funciona igual: los recordatorios llegan como cartel
al abrir la app. Si las claves se regeneran, cada setter tiene que volver a
activar los avisos en su celular.

### Tareas del reloj (opcional)

El vencimiento de leads a las 48 h **no** depende de ninguna tarea programada:
se resuelve al abrir la cola o el tablero, así que el sistema funciona igual en
una máquina sin cron. Lo que sí necesita un programador son los avisos que
llegan solos:

```bash
curl -H "Authorization: Bearer $TAREAS_SECRET" https://tu-dominio/api/tareas
```

Cada 10–15 minutos alcanza. Todo lo que hace es idempotente: cada aviso lleva
una clave con la fecha adentro, así correrlo cinco veces no manda cinco
notificaciones. Sin `TAREAS_SECRET` en el entorno, la ruta no atiende a nadie.

### Probarlo sin datos reales

```bash
npm run demo:setters
```

Crea tres setters con sus cuentas, las dos plantillas de Instagram y 180 leads
scrapeados en el pozo. Imprime los emails y la contraseña con la que entran.

---

## Trabajar desde otra computadora

El repo tiene el código, pero **dos cosas no viajan con él a propósito**: los
secretos y la base de datos. Sin eso, `npm run dev` arranca y falla.

```bash
git clone https://github.com/salvadormosca2-pixel/consola-crm.git
cd consola-crm
npm install
```

### 1. Los secretos

`.env.local` está ignorado, así que hay que crearlo:

```bash
cp .env.example .env.local
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # → AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # → ENCRYPTION_KEY
```

> **Cuidado con `ENCRYPTION_KEY` si las dos máquinas usan la misma base.** Con
> esa clave se cifran el token de Chatwoot y la API key de Evolution. Si en la
> segunda compu generás una distinta, la app no va a poder descifrar las
> credenciales guardadas y va a pedirte que las cargues de nuevo — y al
> guardarlas, la primera compu deja de poder leerlas. **Copiá la misma clave a
> las dos.** `AUTH_SECRET` puede ser distinta: solo invalida las sesiones.

### 2. La base de datos

`.pgdev/` no está en el repo (son 300 MB de binarios). Tres caminos:

| | Cuándo conviene |
| --- | --- |
| `docker compose up -d db redis` | Si esa compu tiene Docker. Es lo más simple. |
| Postgres portable | Bajar el zip de PostgreSQL 16 para Windows, descomprimirlo en `.pgdev/` y correr `.\scripts\pg-local.ps1 init`. Es lo que usa esta máquina porque no tiene Docker. |
| Postgres en la nube | **El único que te deja trabajar con los mismos datos desde las dos compus.** Creás la base en Neon o Supabase y ponés esa `DATABASE_URL` en las dos. |

Con base local, cada máquina tiene su propia copia de los datos y no se
sincronizan: los contactos que importás en una no aparecen en la otra. Si vas a
trabajar en serio desde dos lados, la base en la nube es el camino.

```bash
npm run db:migrate
npm run user:create
npm run dev
```

## Desplegar en Hostinger (Coolify)

El circuito es: **push a `master` → GitHub Actions verifica, construye y publica
la imagen → le avisa a Coolify → Coolify la baja y la pone en servicio.**

El build corre en GitHub y no en el VPS a propósito: `next build` pega un pico
de más de 2 GB y en un KVM 2 eso compite con Chatwoot y Evolution hasta que el
kernel mata alguno. El servidor solo baja la imagen ya hecha.

### Las migraciones no hay que acordarse de correrlas

El contenedor migra la base **antes** de levantar el servidor. Si la migración
falla, el proceso muere, Coolify no lo pone en servicio y sigue andando la
versión anterior. Un despliegue que no sale es mucho mejor que uno roto.

No hace falta ningún comando previo ni acordarse de nada. Reiniciar el
contenedor es gratis: cada migración se aplica una sola vez.

### Qué hay que configurar una sola vez

**En Coolify**, creando la aplicación:

| Campo | Valor |
| --- | --- |
| Imagen | `ghcr.io/salvadormosca2-pixel/consola-crm:latest` |
| Puerto | `3000` |
| Health check | `/api/salud` |

Y las variables de `.env.example`, con tres cuidados:

- `AUTH_URL` es el dominio real con `https://`, no `localhost`.
- `DATABASE_URL` apunta al Postgres del servidor. Si es gestionado y pide TLS,
  además `DATABASE_SSL=true`.
- **`MODO_PRUEBA` no va.** Es la pasarela que entra sin contraseña. El código no
  la compila fuera de desarrollo, pero mejor que la variable ni exista.

**En GitHub → Settings → Secrets and variables → Actions:**

| Secreto | De dónde sale |
| --- | --- |
| `COOLIFY_WEBHOOK` | Coolify → la aplicación → Webhooks → Deploy |
| `COOLIFY_TOKEN` | Coolify → Keys & Tokens → API tokens |

Sin estos dos el CI igual construye y publica la imagen; solo se saltea el aviso
final, y el despliegue se da a mano desde Coolify.

### El primer administrador

La base arranca sin nadie. Para crear la cuenta madre, una sola vez:

```bash
docker run --rm -it --env-file .env \
  ghcr.io/salvadormosca2-pixel/consola-crm:ops npm run user:create
```

Los setters se dan de alta después desde el panel, en **Equipo → Nuevo setter**.

### Antes del primer despliegue

- Respaldar la base. Las migraciones no borran datos, pero un respaldo antes de
  un cambio de esquema no se discute.
- Revisar que `AUTH_SECRET` y `ENCRYPTION_KEY` sean los del servidor y no los de
  desarrollo. Si `AUTH_SECRET` cambia, se cierran todas las sesiones abiertas.

### Verificar que quedó bien

Desde cualquier lado, contra el dominio real:

```bash
VERIFICAR_URL=https://tudominio npm run verificar
```

Abre todas las pantallas y comprueba que cada acción quede guardada. Ojo: el
modo prueba no existe en producción, así que ahí solo corren los chequeos que no
necesitan sesión. Para el resto, entrá y probá a mano.

## Desplegar en Vercel + Railway

La aplicación entera va a **Vercel** y la base a **Railway**. No hay frontend y
backend separados: es una sola aplicación Next.js —las pantallas y la lógica de
servidor viven en el mismo proceso—, así que Vercel la sirve completa.

### 1. La base, en Railway

**New Project → Database → Add PostgreSQL.** No hay nada que configurar.

Después, en la pestaña **Variables** de esa base, copiá **`DATABASE_PUBLIC_URL`**
—la pública, no la interna—: Vercel se conecta desde afuera de Railway.

### 2. La aplicación, en Vercel

**Add New → Project → Import Git Repository** y elegí el repo.

Vercel detecta Next.js solo. El `vercel.json` del repo ya trae lo demás: el
comando de build, la región y la tarea programada.

Las variables, en **Settings → Environment Variables**:

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | el `DATABASE_PUBLIC_URL` de Railway |
| `DATABASE_SSL` | `true` — Railway exige TLS desde afuera |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `AUTH_URL` | tu dominio de Vercel, con `https://` |
| `AUTH_TRUST_HOST` | `true` |
| `OPS_TIMEZONE` | `America/Argentina/Catamarca` |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `VAPID_PUBLIC_KEY` | de `npm run push:claves`, opcional |
| `VAPID_PRIVATE_KEY` | ídem |
| `VAPID_SUBJECT` | `mailto:vos@tudominio` |

**`MODO_PRUEBA` no va.** Es la entrada sin contraseña; el código no la compila
fuera de desarrollo, pero mejor que la variable ni exista.

`AUTH_URL` recién lo sabés después del primer despliegue. Poné cualquier cosa,
desplegá, copiá el dominio real y volvé a desplegar.

### Las migraciones corren en el build

En un servidor propio las corre el contenedor antes de arrancar. En Vercel no
hay contenedor, así que corren en el build, **antes** de compilar: si fallan, el
build falla, Vercel descarta el despliegue y sigue sirviendo la versión
anterior.

Solo se migra cuando `VERCEL_ENV` es `production`. Una vista previa de una rama
compila contra la misma base y no puede cambiarle el esquema a lo que está en
uso.

### El primer usuario

La base arranca vacía. Desde tu máquina, con el `DATABASE_PUBLIC_URL` de
Railway:

```bash
DATABASE_URL='<la url de railway>' DATABASE_SSL=true \
  npx tsx scripts/create-user.ts --email vos@dominio --name "Tu Nombre" --password unaclavelarga
```

Los setters se dan de alta después desde el panel, en **Equipo → Nuevo setter**.

### Las tareas del reloj

`vercel.json` programa `/api/tareas` cada quince minutos. Vercel manda su
`CRON_SECRET` en la cabecera y la ruta lo acepta, así que no hay que cablear
nada.

Eso dispara los recordatorios automáticos, el resumen del día y las alertas de
atraso. El vencimiento de leads **no** depende de esto: se resuelve al abrir la
cola, así que el sistema funciona igual si el cron falla.

### Qué mirar si algo no anda

- **`too many clients`** — la base se quedó sin conexiones. Cada instancia abre
  hasta tres; si Railway tiene un límite bajo, subilo o achicá `MAXIMO` en
  `src/db/index.ts`.
- **El build falla en la migración** — revisá `DATABASE_URL` y que
  `DATABASE_SSL` esté en `true`.
- **El login rebota** — `AUTH_URL` no coincide con el dominio real.
- **`/api/salud` devuelve 503** — la aplicación levantó pero no llega a la base.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run typecheck` | TypeScript sin emitir |
| `npm test` | Tests (vitest) |
| `npm run db:generate` | Genera una migración a partir del esquema Drizzle |
| `npm run db:migrate` | Aplica las migraciones pendientes |
| `npm run db:migrate:test` | Lo mismo, sobre la base de los tests de integración |
| `npm run db:studio` | Explorador visual de la base |
| `npm run user:create` | Da de alta (o repone la contraseña de) un admin |
| `npm run iconos` | Regenera los íconos de la PWA |
| `npm run push:claves` | Genera el par de claves VAPID para las notificaciones |
| `npm run demo:setters` | Equipo de setters de prueba, plantillas de IG y pozo de leads |

Para pasarle argumentos a `user:create` usá `npx tsx` directo, porque npm se
come los flags que empiezan con `--`:

```bash
npx tsx scripts/create-user.ts --email vos@ejemplo.com --name Vos --password "..."
```

---

## Cómo está armado

```
src/
  db/
    enums.ts        Enums de Postgres + sus etiquetas de UI (fuente de verdad única)
    schema.ts       Esquema completo en Drizzle: 12 tablas
    index.ts        Pool de conexiones (uno por proceso)
  lib/
    env.ts          Validación del entorno con Zod: si falta algo, no arranca
    tz.ts           Conversión UTC ↔ zona operativa y formatos de fecha
    form-state.ts   Estado compartido entre formularios y server actions
    validation/     Esquemas Zod de todo lo que entra
  server/
    accounts.ts     Consultas de cuentas (incluida la vista de distribución)
    contacts.ts     Consultas de contactos
    actions/        Server actions (mutaciones)
  components/
    cap-meter.tsx   El medidor de cupo
    ui/             Base de componentes re-estilada
  app/
    ingresar/       Login
    (consola)/      Todo lo que exige sesión
drizzle/            Migraciones versionadas
scripts/            Migrar, crear usuarios, Postgres portable
```

### Decisiones que conviene saber

**Todo se guarda en UTC.** La zona operativa (`OPS_TIMEZONE`, por defecto
`America/Argentina/Catamarca`) se aplica al leer, en `src/lib/tz.ts`. El
contador diario de cada cuenta se reinicia solo: `sent_today` únicamente cuenta
si `counter_date` es la fecha operativa de hoy, así que no hace falta ningún
job de medianoche.

**La asignación de contacto a cuenta es pegada y por canal.** Hay dos columnas,
`assigned_wa_account_id` y `assigned_ig_account_id`, no una sola: un contacto
con los dos canales tiene una cuenta de WhatsApp *y* una de Instagram. El
cliente vio ese número, tiene que seguir viendo ese número.

**`has_whatsapp` significa "el teléfono tiene formato válido", no "tiene
WhatsApp".** En Argentina un fijo y un celular son indistinguibles mirando el
número. La verificación real se hace contra Evolution API en la parte 2 y se
anota en `wa_verified_at`.

**La deduplicación de contactos no depende solo de `dedupe_key`.** Hay índices
únicos parciales sobre `phone_e164` y sobre `lower(ig_username)` por separado,
para que el mismo negocio no entre dos veces cuando un import trae solo
Instagram y el siguiente trae teléfono + Instagram.

**En los archivos `'use server'` solo se exportan funciones async.** Las
constantes y los tipos compartidos van en `src/lib/form-state.ts`: exportar un
objeto desde un módulo de server actions lo deja en `undefined` del lado del
cliente.

**Los errores de Postgres vienen envueltos por Drizzle.** El `code` y la
`constraint` están en `err.cause`, no en `err`. `errorPg()` en
`src/server/actions/accounts.ts` los desenvuelve para poder mostrar "ya hay una
cuenta con ese número" en vez de un error genérico.

**El migrador es propio, no el de Drizzle.** El de Drizzle envuelve todas las
migraciones pendientes en una sola transacción, y eso hace imposible
`ALTER TYPE ... ADD VALUE` seguido de un uso del valor nuevo: Postgres no deja
usarlo hasta que la transacción que lo creó confirmó. `scripts/migrate.ts`
aplica cada archivo en su propia transacción. Los archivos y el journal los
sigue generando `drizzle-kit generate`.

**`messages` es la autoridad del cupo; `sent_today` es caché.** El recuento se
hace dentro de la transacción de reserva, después de tomar el lock de la cuenta,
y sobre un rango UTC precalculado (no `AT TIME ZONE` sobre la columna, que no
usaría el índice). Si la caché difiere, gana `messages` y queda un evento
`cupo_corregido`. Ver `src/server/rotation/reserve.ts`.

**Elegir cuenta y reservar cupo usan locks distintos, y la diferencia importa.**
Elegir usa `FOR UPDATE SKIP LOCKED` (cualquier cuenta elegible sirve, saltear
una tomada es correcto). Reservar usa `FOR UPDATE` a secas sobre la cuenta ya
decidida (saltear sería perder el envío).

**El calentamiento cuenta días de uso, no del almanaque.** Si un número no mandó
el martes, el miércoles sigue en el mismo día de la escala. Por eso hay
`warmup_day` y `warmup_last_advanced_on`, y no alcanzaba con `warmup_started_on`.

**Con Chatwoot hay dos emisores, y eso limita la garantía del cupo.** Los
mensajes que manda la consola siguen bajo garantía transaccional: no pueden
pasarse ni por uno. Pero un mensaje escrito a mano dentro de Chatwoot se cuenta
recién cuando llega el webhook, y en esa ventana la consola cuenta de menos.
Por eso existe `colchonParaRespuestas`: la consola se frena unos mensajes antes
del tope (`techoParaLaConsola()`) y deja lugar para las respuestas a mano. El
cupo real del número sigue siendo `cupoEfectivo()`.

**El `15` de los celulares no se puede borrar a ciegas.** El código de área
argentino tiene 2, 3 o 4 dígitos, así que la posición del `15` es variable. El
invariante que usa `src/lib/phone-ar.ts` es que el número nacional son siempre
10 dígitos (12 si trae el `15`), y prueba los tres largos de área hasta dar con
el que tiene el `15` en el lugar correcto. Hay una ambigüedad real que no se
puede resolver (383 es prefijo de 3837) pero no afecta el E.164, solo lo que se
muestra.

**El parseo del Excel corre en un Web Worker.** 1.000 filas normalizadas en el
hilo principal congelan la pantalla varios segundos. El worker
(`src/workers/parse-sheet.worker.ts`) hace parseo, normalización y dedupe, y va
reportando progreso; el servidor recibe las filas ya listas de a 200.

**SheetJS viene del CDN oficial, no de npm.** El paquete `xlsx` publicado en npm
quedó en 0.18.5 con vulnerabilidades conocidas; las versiones mantenidas se
distribuyen fuera de npm. Por eso `package.json` apunta a un tarball de
`cdn.sheetjs.com`.

**Las credenciales se cifran con AES-256-GCM** (`src/lib/crypto.ts`) usando
`ENCRYPTION_KEY` del entorno. GCM además autentica: si alguien edita el valor en
la base, el descifrado falla en vez de devolver basura. Si perdés la clave, hay
que volver a cargar las credenciales desde Configuración.

---

## Sistema visual

Consola de despacho, no landing de SaaS. Los tokens están en
`src/app/globals.css` y no se improvisan colores fuera de ahí.

| | |
| --- | --- |
| Fondo · Superficie · Elevada | `#141A22` · `#1E2732` · `#26313E` |
| Bordes · Texto · Texto secundario | `#33404F` · `#E6EAF0` · `#8D9BAB` |
| Ámbar señal | `#E8A33D` — acción principal, cupos, abrir canal |
| Verde agua | `#4FB3A6` — respondió, cerrado, positivo |
| Rojo | `#D2544B` — bloqueado, perdido, límite alcanzado |

Títulos en **Chivo** 700 con seguimiento negativo, interfaz en **Inter**,
**JetBrains Mono** para todo dato de instrumento (teléfonos, usuarios, cupos,
contadores, marcas de tiempo) con la clase `.dato`.

Sin degradados. Sin sombras difusas grandes. Radios de 4–6 px, nunca cápsulas.
Animación solo funcional, 150–200 ms, y respetando `prefers-reduced-motion`.

El **medidor de cupo** (`src/components/cap-meter.tsx`) es la única pieza
decorativa permitida, y es informativa: una barra segmentada por cuenta, que se
llena en ámbar, pasa a rojo al tope y se atenúa si la cuenta está pausada o
bloqueada.

---

## Qué falta

**Parte 1** (cargar y ordenar la base):

| Fase | Qué entra |
| --- | --- |
| ~~2~~ | ~~Importador de Excel~~ — **hecho** |
| 3 | Tabla de contactos virtualizada, filtros guardables, ficha lateral con línea de tiempo |
| 4 | Plantillas con variables, variantes rotativas, vista previa con contacto real |
| ~~5~~ | ~~Reparto entre cuentas~~ — **hecho**, va dentro del importador |

**Parte 2** (mandar, seguir y medir):

| Fase | Qué entra |
| --- | --- |
| 2 | Modo piloto: tanda de un número, ventana de 24 h, semáforo, comparación de variantes |
| 3 | Despachador Instagram: bloques por cuenta, portapapeles + link, cambio de cuenta con confirmación |
| 4 | Despachador WhatsApp: envío por la API de **Chatwoot**, prioridad de cola, modo lote, respaldo directo a Evolution si Chatwoot no responde |
| 5 | Etapas y secuencias con corte absoluto al responder |
| 6 | Respuestas por el webhook de **Chatwoot**: bandeja, clasificación, score con desglose, indicador de sincronización |
| 7 | Métricas por cuenta, plantilla, variante y rubro |
| ~~8~~ | ~~Calendario y reuniones~~ — **hecho** con el módulo de setters |
| 9 | Configuración: mapeo cuenta ↔ inbox, credenciales cifradas, exportaciones |

**Módulo de setters** — lo único que quedó afuera:

| Qué | Por qué |
| --- | --- |
| Avisos por correo | Mandar mails necesita un proveedor de envío (Resend, SES, un SMTP) que todavía no está elegido. La pantalla de "Avisos que quiero recibir" tiene campana y push; el correo se suma como un canal más cuando se decida. |

**Chatwoot es la bandeja; la consola es el cerebro.** Evolution habla solo con
Chatwoot, y la consola habla solo con Chatwoot: si los dos escucharan a
Evolution, cada mensaje entraría dos veces. La rotación, los cupos y el
calentamiento se siguen decidiendo en la consola, que elige el inbox
correspondiente a la cuenta asignada.

---

## Chatwoot embebido: qué tocar en el servidor

La sección **Mensajes** muestra Chatwoot completo dentro de un iframe. Para que
cargue hay que hacer dos cosas en tu servidor de Chatwoot. La consola detecta
sola si falta alguna y te lo dice en pantalla con el valor exacto.

### 1. Permitir el iframe

Chatwoot manda `X-Frame-Options: SAMEORIGIN`, que le prohíbe al navegador
mostrarlo dentro de otra página. **Esa cabecera no admite excepciones por
dominio**: hay que sacarla y reemplazarla por `frame-ancestors`, que sí permite
autorizar un dominio puntual.

No hay variable de entorno de Chatwoot para esto: la cabecera la pone el reverse
proxy que tenés adelante.

**nginx** — en el bloque `server` de Chatwoot:

```nginx
# Sacar cualquier línea que diga:
#   add_header X-Frame-Options SAMEORIGIN;
proxy_hide_header X-Frame-Options;
add_header Content-Security-Policy "frame-ancestors 'self' https://crm.tudominio.com" always;
```

**Caddy**:

```
header {
  -X-Frame-Options
  Content-Security-Policy "frame-ancestors 'self' https://crm.tudominio.com"
}
```

**Traefik** — en el middleware de headers del router de Chatwoot:

```yaml
customResponseHeaders:
  X-Frame-Options: ""
  Content-Security-Policy: "frame-ancestors 'self' https://crm.tudominio.com"
```

Si Chatwoot corre en Docker con su propio nginx adelante, el cambio va en **ese**
nginx, no en el contenedor de Rails. Después recargá el proxy
(`nginx -s reload`) y volvé a la sección Mensajes.

> En **Chatwoot Cloud** esto no se puede cambiar. Ahí el iframe no es viable y la
> consola te ofrece abrirlo en una pestaña, con el webhook funcionando igual.

### 2. Servir todo bajo el mismo dominio raíz

Si la consola y Chatwoot están en dominios raíz distintos, el navegador puede
bloquear la cookie de sesión de Chatwoot dentro del iframe y vas a tener que
loguearte una y otra vez.

```
crm.tudominio.com     → la consola
chat.tudominio.com    → Chatwoot
```

Con eso la cookie viaja bien. La consola detecta si los dominios no coinciden y
te avisa arriba de la bandeja.

### 3. El webhook, que es obligatorio

**Un iframe no le cuenta nada a la página que lo contiene.** Chatwoot adentro de
la consola no avisa cuándo llega una respuesta, así que la sincronización va por
atrás igual — y sin ella el sistema se rompe: la consola creería que nadie
contestó y seguiría mandando seguimientos a gente que ya respondió.

En Chatwoot: **Configuración → Integraciones → Webhooks**, y agregá la URL que
te muestra la pantalla de Configuración de la consola (ya viene con el secreto),
con los eventos `message_created` y `conversation_status_changed`.

El indicador del encabezado de Mensajes se pone verde si llegó algo en los
últimos 15 minutos y rojo si hace más de una hora que no llega nada habiendo
mensajes enviados.

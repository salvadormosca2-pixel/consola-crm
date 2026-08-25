# syntax=docker/dockerfile:1

# Imagen de la consola. Se construye en GitHub Actions, no en el VPS: en un
# KVM 2 el pico de `next build` (2+ GB) compite con Chatwoot y Evolution y el
# kernel termina matando algún contenedor.
#
# Debian slim y no Alpine a propósito: @node-rs/argon2 publica binarios
# precompilados para glibc. Con musl habría que compilarlo desde el código.

# ── dependencias ──────────────────────────────────────────────────────────────
# Capa aparte para que el `npm ci` se cachee mientras no cambie el lockfile.
# Necesita salida a internet: `xlsx` no viene de npm sino de cdn.sheetjs.com.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── build ─────────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Valores de relleno SOLO para que `next build` no falle al validar el entorno.
# Nunca llegan a la imagen final: esta etapa se descarta y el runtime recibe
# las variables de verdad desde Coolify.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
ENV DATABASE_SSL=false
ENV AUTH_SECRET=relleno-de-compilacion-no-usar-en-produccion-000
ENV ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=

RUN npm run build

# ── ops ───────────────────────────────────────────────────────────────────────
# Migraciones y alta de usuarios. Van en su propia imagen porque necesitan tsx
# y las dependencias de desarrollo, que el runtime no tiene.
#
#   docker run --rm --env-file .env consola:ops                          → migra
#   docker run --rm -it --env-file .env consola:ops npm run user:create  → usuario
FROM node:22-slim AS ops
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 TZ=UTC
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY scripts ./scripts
COPY drizzle ./drizzle
COPY src ./src
CMD ["npm", "run", "db:migrate"]

# ── runtime ───────────────────────────────────────────────────────────────────
# Solo el servidor standalone: Next rastrea qué módulos usa de verdad y copia
# esos, así que node_modules entero no viaja.
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=UTC

# El servidor no corre como root. Si alguna vez se escapa algo del proceso,
# que no sea con todos los permisos de la máquina.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# Coolify espera este 200 antes de mandarle tráfico al contenedor nuevo. El
# endpoint consulta la base: un proceso que levantó pero no llega a Postgres
# está tan caído como uno que no arrancó.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

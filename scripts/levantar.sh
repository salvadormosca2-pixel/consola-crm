#!/usr/bin/env bash
#
# Levanta ECOSYSTEM en un servidor con Docker, de una.
#
#   curl -fsSL https://raw.githubusercontent.com/salvadormosca2-pixel/consola-crm/master/scripts/levantar.sh | bash
#
# Existe porque pegar un comando de novecientos caracteres en la terminal del
# navegador no funciona: se corta a la mitad y falla de formas que no dicen
# nada. Esto es una línea.
#
# Crea su propia red, su propia base y levanta la app. Es idempotente: si algo
# ya existe, lo reusa; si lo corrés dos veces, no rompe nada. Los secretos se
# generan una sola vez y quedan guardados, así reiniciar no cierra las sesiones
# abiertas ni deja ilegible lo que ya estaba cifrado.
#
# No toca nada de lo que ya tengas andando.

set -euo pipefail

RED=ecosystem
BASE=ecosystem-db
APP=ecosystem-app
IMAGEN=ghcr.io/salvadormosca2-pixel/consola-crm:latest
SECRETOS=/root/.ecosystem.env

echo
echo "── ECOSYSTEM ─────────────────────────────────────────────"
echo

# ── Lo que tiene que estar ────────────────────────────────────────────────
for programa in docker openssl curl; do
  if ! command -v "$programa" >/dev/null 2>&1; then
    echo "Falta $programa. Instalalo y volvé a correr esto."
    exit 1
  fi
done

# ── Un puerto libre ───────────────────────────────────────────────────────
# Si 3001 está ocupado por otra cosa, docker falla con un error que no explica
# nada. Mejor buscar uno libre y decirlo.
PUERTO=${PUERTO:-3001}
libre() { ! (docker ps --format '{{.Ports}}' | grep -q ":$1->"); }
while ! libre "$PUERTO"; do
  echo "El puerto $PUERTO está ocupado, pruebo el siguiente"
  PUERTO=$((PUERTO + 1))
  if [ "$PUERTO" -gt 3020 ]; then
    echo "No encontré un puerto libre entre 3001 y 3020."
    exit 1
  fi
done

# ── Los secretos, una sola vez ────────────────────────────────────────────
# Van entre comillas simples porque base64 incluye / y +: sin comillas, el
# shell los interpretaría al leer el archivo.
if [ ! -f "$SECRETOS" ]; then
  echo "Generando secretos (una sola vez, quedan en $SECRETOS)"
  umask 077
  {
    echo "CLAVE_BASE='$(openssl rand -hex 24)'"
    echo "AUTH_SECRET='$(openssl rand -base64 32)'"
    echo "ENCRYPTION_KEY='$(openssl rand -base64 32)'"
    echo "TAREAS_SECRET='$(openssl rand -hex 32)'"
  } > "$SECRETOS"
else
  echo "Secretos ya existentes: los reuso"
fi
# shellcheck disable=SC1090
. "$SECRETOS"

# ── La red ────────────────────────────────────────────────────────────────
if ! docker network inspect "$RED" >/dev/null 2>&1; then
  docker network create "$RED" >/dev/null
  echo "Red $RED creada"
else
  echo "Red $RED ya existe"
fi

# ── La base ───────────────────────────────────────────────────────────────
if ! docker ps -a --format '{{.Names}}' | grep -qx "$BASE"; then
  echo "Levantando Postgres"
  docker run -d --name "$BASE" --restart unless-stopped --network "$RED" \
    -e POSTGRES_USER=ecosystem \
    -e POSTGRES_PASSWORD="$CLAVE_BASE" \
    -e POSTGRES_DB=ecosystem \
    -e TZ=UTC -e PGTZ=UTC \
    -v ecosystem_datos:/var/lib/postgresql/data \
    postgres:16-alpine >/dev/null
else
  docker start "$BASE" >/dev/null 2>&1 || true
  echo "Postgres ya existe: lo dejo andando"
fi

# La app arranca más rápido que Postgres y se encontraría la puerta cerrada.
printf "Esperando a la base"
listo=no
for _ in $(seq 1 60); do
  if docker exec "$BASE" pg_isready -U ecosystem -d ecosystem >/dev/null 2>&1; then
    listo=si
    echo " · lista"
    break
  fi
  printf "."
  sleep 2
done
if [ "$listo" = no ]; then
  echo
  echo "La base no llegó a aceptar conexiones. Qué dijo:"
  docker logs --tail 20 "$BASE"
  exit 1
fi

# ── La app ────────────────────────────────────────────────────────────────
# Se reemplaza siempre, para que correr el script otra vez traiga la versión
# nueva de la imagen. La base no se toca: los datos viven en su volumen.
docker rm -f "$APP" >/dev/null 2>&1 || true

echo "Bajando la última imagen"
docker pull "$IMAGEN" >/dev/null

# La primera de `hostname -I` es la interfaz principal. Si el servidor está
# detrás de NAT puede ser una dirección interna: no rompe nada —el login
# confía en el host del pedido— pero la línea final mostraría esa.
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -n "$IP" ] || IP=127.0.0.1

echo "Levantando la app"
docker run -d --name "$APP" --restart unless-stopped --network "$RED" \
  -p "${PUERTO}:3000" \
  -e DATABASE_URL="postgres://ecosystem:${CLAVE_BASE}@${BASE}:5432/ecosystem" \
  -e DATABASE_SSL=false \
  -e AUTH_SECRET="$AUTH_SECRET" \
  -e ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  -e TAREAS_SECRET="$TAREAS_SECRET" \
  -e AUTH_URL="http://${IP}:${PUERTO}" \
  -e AUTH_TRUST_HOST=true \
  -e OPS_TIMEZONE=America/Argentina/Catamarca \
  -e TZ=UTC \
  "$IMAGEN" >/dev/null

# ── Esperar a que conteste ────────────────────────────────────────────────
printf "Migrando y arrancando"
for _ in $(seq 1 90); do
  if curl -fsS -m 3 "http://127.0.0.1:${PUERTO}/api/salud" >/dev/null 2>&1; then
    echo
    echo
    echo "  Andando:  http://${IP}:${PUERTO}"
    echo
    echo "  Ahora creá tu usuario con:"
    echo "    curl -fsSL https://raw.githubusercontent.com/salvadormosca2-pixel/consola-crm/master/scripts/crear-usuario.sh | bash"
    echo
    exit 0
  fi
  printf "."
  sleep 2
done

echo
echo "No llegó a responder. Qué dijo:"
echo
docker logs --tail 40 "$APP"
exit 1

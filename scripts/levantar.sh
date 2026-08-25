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
# abiertas.
#
# No toca nada de lo que ya tengas andando.

set -euo pipefail

RED=ecosystem
BASE=ecosystem-db
APP=ecosystem-app
PUERTO=${PUERTO:-3001}
IMAGEN=ghcr.io/salvadormosca2-pixel/consola-crm:latest
SECRETOS=/root/.ecosystem.env

echo
echo "── ECOSYSTEM ─────────────────────────────────────────────"
echo

# ── Los secretos, una sola vez ────────────────────────────────────────────
# Si se regeneraran en cada corrida, cada reinicio cerraría todas las sesiones
# y dejaría ilegible lo que ya estaba cifrado en la base.
if [ ! -f "$SECRETOS" ]; then
  echo "Generando secretos (una sola vez, quedan en $SECRETOS)"
  umask 077
  {
    echo "CLAVE_BASE=$(openssl rand -hex 24)"
    echo "AUTH_SECRET=$(openssl rand -base64 32)"
    echo "ENCRYPTION_KEY=$(openssl rand -base64 32)"
    echo "TAREAS_SECRET=$(openssl rand -hex 32)"
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
for _ in $(seq 1 60); do
  if docker exec "$BASE" pg_isready -U ecosystem -d ecosystem >/dev/null 2>&1; then
    echo " · lista"
    break
  fi
  printf "."
  sleep 2
done

# ── La app ────────────────────────────────────────────────────────────────
# Se reemplaza siempre, para que correr el script otra vez traiga la versión
# nueva de la imagen. La base no se toca: los datos viven en su volumen.
docker rm -f "$APP" >/dev/null 2>&1 || true

echo "Bajando la última imagen"
docker pull -q "$IMAGEN" >/dev/null

IP=$(hostname -I | awk '{print $1}')

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
    echo "  Listo:  http://${IP}:${PUERTO}"
    echo
    echo "  El primer usuario, una sola vez:"
    echo "    docker run --rm -it --network ${RED} --env-file ${SECRETOS} \\"
    echo "      -e DATABASE_URL=\"postgres://ecosystem:\${CLAVE_BASE}@${BASE}:5432/ecosystem\" \\"
    echo "      ghcr.io/salvadormosca2-pixel/consola-crm:ops npm run user:create"
    echo
    exit 0
  fi
  printf "."
  sleep 2
done

echo
echo "No llegó a responder. Qué dijo:"
echo
docker logs --tail 30 "$APP"
exit 1

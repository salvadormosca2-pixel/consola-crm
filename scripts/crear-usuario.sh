#!/usr/bin/env bash
#
# Crea el primer usuario, el dueño del sistema.
#
#   curl -fsSL .../crear-usuario.sh | bash -s -- tumail@dominio "Tu Nombre" tuclave
#
# Los tres datos van como parámetros y no preguntando de a uno: cuando el
# script llega por una tubería (`curl | bash`) la entrada del teclado está
# tomada por curl, y cualquier pregunta se saltea sola con una respuesta vacía.
#
# Se corre una sola vez. Los setters se dan de alta después desde el panel, en
# Equipo → Nuevo setter, que además te da la tarjeta de acceso lista para
# mandarles por WhatsApp.
#
# Si el email ya existe, le cambia la contraseña en vez de fallar.

set -euo pipefail

RED=ecosystem
BASE=ecosystem-db
SECRETOS=/root/.ecosystem.env

EMAIL=${1:-}
NOMBRE=${2:-}
CLAVE=${3:-}

if [ -z "$EMAIL" ] || [ -z "$NOMBRE" ] || [ -z "$CLAVE" ]; then
  echo
  echo "Faltan datos. Se usa así:"
  echo
  echo "  curl -fsSL https://raw.githubusercontent.com/salvadormosca2-pixel/consola-crm/master/scripts/crear-usuario.sh | bash -s -- tumail@dominio.com \"Tu Nombre\" tucontraseña"
  echo
  echo "La contraseña necesita al menos 10 caracteres."
  echo
  exit 1
fi

if [ ${#CLAVE} -lt 10 ]; then
  echo "La contraseña necesita al menos 10 caracteres."
  exit 1
fi

if [ ! -f "$SECRETOS" ]; then
  echo "No encuentro $SECRETOS. Corré primero:"
  echo "  curl -fsSL https://raw.githubusercontent.com/salvadormosca2-pixel/consola-crm/master/scripts/levantar.sh | bash"
  exit 1
fi
# shellcheck disable=SC1090
. "$SECRETOS"

docker run --rm --network "$RED" \
  -e DATABASE_URL="postgres://ecosystem:${CLAVE_BASE}@${BASE}:5432/ecosystem" \
  -e DATABASE_SSL=false \
  -e AUTH_SECRET="$AUTH_SECRET" \
  -e ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  ghcr.io/salvadormosca2-pixel/consola-crm:ops \
  npx tsx scripts/create-user.ts --email "$EMAIL" --name "$NOMBRE" --password "$CLAVE"

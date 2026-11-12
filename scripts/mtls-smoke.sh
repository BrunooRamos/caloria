#!/usr/bin/env bash
# Prueba el mTLS entre el Front Service y el Backend (RNF-03) contra el stack levantado.
#
# 1. Por la API pública (nginx → Front → Backend): registra un usuario, sube una comida (202) y la
#    lee (200). El camino de la app sigue igual.
# 2. Desde un contenedor en la red front-back, o sea pegándole directo al Backend:
#    - por HTTP plano → rechazado
#    - por HTTPS sin certificado de cliente → rechazado
#    - con un certificado "caloria-front" de otra CA (una credencial falsa) → rechazado
#    - con el certificado real del Front → 200 (control, primero: lo que se rechaza es la credencial)
#
# Requisitos: npm run certs:generate, el stack levantado
# (docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d), curl y node.
# Si el stack usa otro nombre de proyecto: COMPOSE_PROJECT_NAME=<nombre> bash scripts/mtls-smoke.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${BASE_URL:-http://localhost:8080/api/v1}"
CERTS="${CERTS:-$REPO_ROOT/infra/certs/mtls}"
CURL_IMAGE="curlimages/curl:8.11.1"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() {
  echo "✖ $*" >&2
  exit 1
}
ok() { echo "  ✔ $*"; }

json_field() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v=JSON.parse(s);for(const k of process.argv[1].split("."))v=v?.[k];process.stdout.write(v===undefined?"":String(v))})' "$1"
}

[ -f "$CERTS/front/cert.pem" ] || fail "No hay certificados en $CERTS: corré npm run certs:generate"

echo "→ La app, por nginx → Front → Backend ($BASE_URL)"
PHOTO="$TMP/plato.jpg"
{ printf '\xff\xd8\xff\xe0'; head -c 1020 /dev/zero; } >"$PHOTO"
EMAIL="mtls-smoke-$(date +%s)-$RANDOM@example.com"
REGISTER=$(curl -sS -X POST "$BASE_URL/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"una-password-larga\",\"profile\":{\"sex\":\"female\",\"birthDate\":\"2002-04-10\",\"heightCm\":165,\"weightKg\":60,\"activity\":\"moderate\",\"goal\":\"maintain\",\"timezone\":\"America/Montevideo\"}}")
TOKEN=$(printf '%s' "$REGISTER" | json_field accessToken)
[ -n "$TOKEN" ] || fail "el registro no devolvió accessToken: $REGISTER"
ok "POST /auth/register → accessToken"

STATUS=$(curl -sS -o "$TMP/meal.json" -w '%{http_code}' -X POST "$BASE_URL/meals" \
  -H "authorization: Bearer $TOKEN" -F "photo=@$PHOTO;type=image/jpeg")
[ "$STATUS" = 202 ] || fail "POST /meals respondió $STATUS: $(cat "$TMP/meal.json")"
MEAL_ID=$(json_field mealId <"$TMP/meal.json")
ok "POST /meals → 202 (mealId $MEAL_ID)"

STATUS=$(curl -sS -o "$TMP/get.json" -w '%{http_code}' "$BASE_URL/meals/$MEAL_ID" \
  -H "authorization: Bearer $TOKEN")
[ "$STATUS" = 200 ] || fail "GET /meals/$MEAL_ID respondió $STATUS: $(cat "$TMP/get.json")"
ok "GET /meals/$MEAL_ID → 200 (status $(json_field status <"$TMP/get.json"))"

echo "→ Directo al Backend (https://back:4000), desde la red front-back"
BACK=$(docker compose -f "$REPO_ROOT/infra/docker-compose.yml" ps -q back)
[ -n "$BACK" ] || fail "no encontré el contenedor back (¿COMPOSE_PROJECT_NAME?)"
NETWORK=$(docker inspect "$BACK" --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' | grep 'front-back$' || true)
[ -n "$NETWORK" ] || fail "el contenedor back no está en la red front-back"

# Una credencial falsa: misma forma y mismo CN que la del Front, pero de otra CA.
bash "$REPO_ROOT/scripts/generate-mtls-certs.sh" "$TMP/falsa" >/dev/null
# El contenedor de curl no corre como root: va una copia legible de las dos credenciales.
cp -R "$CERTS/front" "$TMP/real"
chmod 644 "$TMP"/falsa/front/key.pem "$TMP"/real/key.pem

docker pull -q "$CURL_IMAGE" >/dev/null
# Corre curl en un contenedor efímero en la red front-back. Deja el código HTTP en $HTTP, el exit
# code en $CODE (el de curl, o 125+ si falló docker) y el error en $ERR.
direct() {
  set +e
  HTTP=$(docker run --rm --network "$NETWORK" \
    -v "$TMP/real:/real:ro" -v "$TMP/falsa/front:/falsa:ro" \
    "$CURL_IMAGE" -sS -m 5 -o /dev/null -w '%{http_code}' "$@" 2>"$TMP/err")
  CODE=$?
  set -e
  ERR=$(tr '\n' ' ' <"$TMP/err" | cut -c1-100)
}
# Solo cuenta como rechazo un corte de la conexión o del handshake (curl 35, 52 o 56). Cualquier
# otro error (docker, red, DNS, timeout) hace fallar la prueba en vez de pasar por rechazo.
rejected() {
  local name="$1"
  shift
  direct "$@"
  case "$CODE" in
    35 | 52 | 56) ok "$name → rechazado ($ERR)" ;;
    0) fail "$name: el Backend respondió $HTTP" ;;
    *) fail "$name: la prueba no llegó al Backend (exit $CODE): $ERR" ;;
  esac
}

# Primero el control: con el certificado real responde. Así un rechazo después no puede ser un
# problema del contenedor, la red o los certificados montados.
direct --cacert /real/ca.pem --cert /real/cert.pem --key /real/key.pem https://back:4000/health
[ "$CODE" = 0 ] && [ "$HTTP" = 200 ] ||
  fail "con el certificado real del Front se esperaba 200 y vino $HTTP (exit $CODE): $ERR"
ok "certificado real del Front → 200 (control)"

rejected "HTTP plano" http://back:4000/health
rejected "HTTPS sin certificado" --cacert /real/ca.pem https://back:4000/health
rejected "certificado falso (otra CA)" \
  --cacert /real/ca.pem --cert /falsa/cert.pem --key /falsa/key.pem https://back:4000/health

echo "✔ mTLS OK: el Backend solo atiende al Front"

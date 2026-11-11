#!/usr/bin/env bash
# Prueba a mano el feature gating (RF-15) pegándole a la API con curl, sin la app.
#
# 1. Registra un usuario free nuevo.
# 2. Manda fotos a POST /meals hasta agotar el cupo y muestra el 402 MEAL_QUOTA_EXCEEDED.
# 3. Si se pasa PREMIUM_PATH, llama a esa ruta con el usuario free y espera 402 PREMIUM_REQUIRED.
#
# Requisitos: el stack levantado (docker compose -f infra/docker-compose.yml up), con un cupo chico
# (por ejemplo FREE_MONTHLY_ANALYSES=3 en infra/.env, menor que el tope diario DAILY_ANALYSES_FREE),
# curl y node. Si nginx frena la ráfaga (429 RATE_LIMITED), espera el Retry-After y sigue.
# Conviene tener el worker apagado: así ninguna comida termina failed (y devuelve cupo) mientras corre el script.
#
# Uso: bash scripts/quota-smoke.sh
#      BASE_URL=http://localhost:8080/api/v1 MAX_MEALS=50 bash scripts/quota-smoke.sh
#      PREMIUM_PATH=/ruta-premium bash scripts/quota-smoke.sh   # cuando exista una ruta solo premium
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080/api/v1}"
MAX_MEALS="${MAX_MEALS:-100}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() {
  echo "✖ $*" >&2
  exit 1
}

# Lee un campo de un JSON por stdin: json_field error.code
json_field() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v=JSON.parse(s);for(const k of process.argv[1].split("."))v=v?.[k];process.stdout.write(v===undefined?"":String(v))})' "$1"
}

# JPEG mínimo: el Backend detecta el tipo por los primeros bytes.
PHOTO="$TMP/plato.jpg"
{ printf '\xff\xd8\xff\xe0'; head -c 1020 /dev/zero; } >"$PHOTO"

EMAIL="quota-smoke-$(date +%s)-$RANDOM@example.com"
echo "→ POST /auth/register ($EMAIL)"
REGISTER=$(curl -sS -X POST "$BASE_URL/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"una-password-larga\",\"profile\":{\"sex\":\"female\",\"birthDate\":\"2002-04-10\",\"heightCm\":165,\"weightKg\":60,\"activity\":\"moderate\",\"goal\":\"maintain\",\"timezone\":\"America/Montevideo\"}}")
TOKEN=$(printf '%s' "$REGISTER" | json_field accessToken)
[ -n "$TOKEN" ] || fail "el registro no devolvió accessToken: $REGISTER"

echo "→ POST /meals hasta agotar el cupo (máximo $MAX_MEALS)"
accepted=0
for _ in $(seq 1 "$MAX_MEALS"); do
  STATUS=$(curl -sS -o "$TMP/body.json" -D "$TMP/headers" -w '%{http_code}' -X POST "$BASE_URL/meals" \
    -H "authorization: Bearer $TOKEN" \
    -F "photo=@$PHOTO;type=image/jpeg")
  case "$STATUS" in
    202) accepted=$((accepted + 1)); echo "  202 ($accepted)" ;;
    402) break ;;
    429)
      # RATE_LIMITED es el límite por IP de nginx: se espera lo que dice Retry-After y se sigue.
      [ "$(json_field error.code <"$TMP/body.json")" = RATE_LIMITED ] || break
      WAIT=$(sed -n 's/^[Rr]etry-[Aa]fter: *\([0-9]*\).*/\1/p' "$TMP/headers" | head -n1)
      echo "  429 RATE_LIMITED de nginx, espero ${WAIT:-30} s"
      sleep "${WAIT:-30}"
      ;;
    *) fail "POST /meals respondió $STATUS: $(cat "$TMP/body.json")" ;;
  esac
done
[ "$STATUS" = 402 ] || fail "después de $MAX_MEALS fotos no llegó el 402 (¿FREE_MONTHLY_ANALYSES muy alto?)"
CODE=$(json_field error.code <"$TMP/body.json")
[ "$CODE" = MEAL_QUOTA_EXCEEDED ] || fail "se esperaba MEAL_QUOTA_EXCEEDED y vino $CODE"
echo "✔ $accepted aceptadas y después 402:"
cat "$TMP/body.json"
echo

if [ -n "${PREMIUM_PATH:-}" ]; then
  echo "→ GET $PREMIUM_PATH con usuario free"
  STATUS=$(curl -sS -o "$TMP/body.json" -w '%{http_code}' "$BASE_URL$PREMIUM_PATH" \
    -H "authorization: Bearer $TOKEN")
  CODE=$(json_field error.code <"$TMP/body.json")
  [ "$STATUS" = 402 ] && [ "$CODE" = PREMIUM_REQUIRED ] ||
    fail "se esperaba 402 PREMIUM_REQUIRED y vino $STATUS $(cat "$TMP/body.json")"
  echo "✔ 402 PREMIUM_REQUIRED:"
  cat "$TMP/body.json"
  echo
else
  echo "· Sin PREMIUM_PATH: hoy no hay rutas solo premium (requirePremium no está en ninguna ruta real)."
fi

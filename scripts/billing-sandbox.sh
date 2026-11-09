#!/usr/bin/env bash
# Prueba a mano la suscripción premium (RF-16) contra el sandbox real de Stripe, sin la app.
# Los pasos completos (cuenta de Stripe, precio, stripe listen) están en docs/billing-sandbox.md.
#
# 1. Registra un usuario free nuevo y muestra GET /billing/plan (free, con cupo).
# 2. POST /billing/subscribe → imprime la URL del Checkout de Stripe y espera a que pagues ahí
#    con una tarjeta de prueba (4242 4242 4242 4242). La tarjeta se carga en Stripe, nunca acá.
# 3. Espera a que el webhook (vía `stripe listen`) pase el plan a premium.
# 4. POST /billing/subscribe otra vez → 409 SUBSCRIPTION_ACTIVE.
# 5. POST /billing/cancel dos veces → premium con renews=false, la misma respuesta las dos veces.
# 6. POST /billing/subscribe → reactiva la misma suscripción (renews=true).
# 7. Webhook sin firma → 400.
#
# Requisitos: el stack levantado con las variables de Stripe en infra/.env, `stripe listen`
# reenviando a $BASE_URL/billing/webhook, curl y node.
#
# Uso: bash scripts/billing-sandbox.sh
#      BASE_URL=http://localhost:8080/api/v1 WAIT_SECONDS=300 bash scripts/billing-sandbox.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080/api/v1}"
WAIT_SECONDS="${WAIT_SECONDS:-300}"

fail() {
  echo "✖ $*" >&2
  exit 1
}

# Lee un campo de un JSON por stdin: json_field plan.tier
json_field() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v=JSON.parse(s);for(const k of process.argv[1].split("."))v=v?.[k];process.stdout.write(v===undefined?"":v===null?"null":String(v))})' "$1"
}

# call METHOD PATH → deja el body en $BODY y el status en $STATUS
call() {
  local out
  out=$(curl -sS -w '\n%{http_code}' -X "$1" "$BASE_URL$2" -H "authorization: Bearer $TOKEN")
  STATUS="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
}

EMAIL="billing-sandbox-$(date +%s)-$RANDOM@example.com"
echo "→ POST /auth/register ($EMAIL)"
REGISTER=$(curl -sS -X POST "$BASE_URL/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"una-password-larga\",\"profile\":{\"sex\":\"female\",\"birthDate\":\"2002-04-10\",\"heightCm\":165,\"weightKg\":60,\"activity\":\"moderate\",\"goal\":\"maintain\",\"timezone\":\"America/Montevideo\"}}")
TOKEN=$(printf '%s' "$REGISTER" | json_field accessToken)
[ -n "$TOKEN" ] || fail "el registro no devolvió accessToken: $REGISTER"

echo "→ GET /billing/plan"
call GET /billing/plan
[ "$STATUS" = 200 ] || fail "GET /billing/plan respondió $STATUS: $BODY"
echo "  $BODY"
[ "$(printf '%s' "$BODY" | json_field tier)" = free ] || fail "un usuario nuevo tendría que ser free"

echo "→ POST /billing/subscribe"
call POST /billing/subscribe
[ "$STATUS" = 200 ] || fail "subscribe respondió $STATUS: $BODY"
CHECKOUT=$(printf '%s' "$BODY" | json_field checkoutUrl)
[ -n "$CHECKOUT" ] || fail "subscribe no devolvió checkoutUrl: $BODY"
echo
echo "  Abrí esta URL y pagá con 4242 4242 4242 4242, cualquier fecha futura y cualquier CVC:"
echo "  $CHECKOUT"
echo

echo "→ Esperando el webhook (hasta ${WAIT_SECONDS}s): GET /billing/plan hasta ver premium"
deadline=$((SECONDS + WAIT_SECONDS))
while :; do
  call GET /billing/plan
  [ "$(printf '%s' "$BODY" | json_field tier)" = premium ] && break
  [ "$SECONDS" -lt "$deadline" ] || fail "no pasó a premium. ¿Está corriendo stripe listen? Plan: $BODY"
  sleep 3
done
echo "  ✔ premium: $BODY"
[ "$(printf '%s' "$BODY" | json_field analyses.remaining)" = null ] || fail "premium tendría que tener remaining null"
[ "$(printf '%s' "$BODY" | json_field renews)" = true ] || fail "tendría que renovarse"

echo "→ POST /billing/subscribe con premium activo"
call POST /billing/subscribe
[ "$STATUS" = 409 ] || fail "esperaba 409, vino $STATUS: $BODY"
[ "$(printf '%s' "$BODY" | json_field error.code)" = SUBSCRIPTION_ACTIVE ] || fail "código: $BODY"
echo "  ✔ 409 SUBSCRIPTION_ACTIVE"

echo "→ POST /billing/cancel (dos veces)"
call POST /billing/cancel
[ "$STATUS" = 200 ] || fail "cancel respondió $STATUS: $BODY"
FIRST="$BODY"
[ "$(printf '%s' "$BODY" | json_field tier)" = premium ] || fail "cancelar no corta el premium: $BODY"
[ "$(printf '%s' "$BODY" | json_field renews)" = false ] || fail "cancelado no se renueva: $BODY"
call POST /billing/cancel
[ "$STATUS" = 200 ] && [ "$BODY" = "$FIRST" ] || fail "el segundo cancel difiere: $STATUS $BODY"
echo "  ✔ sigue premium hasta $(printf '%s' "$BODY" | json_field periodEnd), sin renovar"

echo "→ POST /billing/subscribe estando cancelado (reactiva)"
call POST /billing/subscribe
[ "$STATUS" = 200 ] || fail "subscribe respondió $STATUS: $BODY"
[ "$(printf '%s' "$BODY" | json_field action)" = reactivated ] || fail "esperaba reactivated: $BODY"
[ "$(printf '%s' "$BODY" | json_field plan.renews)" = true ] || fail "reactivado se renueva: $BODY"
echo "  ✔ reactivada la misma suscripción"

echo "→ POST /billing/webhook sin firma"
STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/billing/webhook" \
  -H 'content-type: application/json' -d '{"id":"evt_falso","type":"customer.subscription.deleted"}')
[ "$STATUS" = 400 ] || fail "un webhook sin firma tendría que dar 400, dio $STATUS"
echo "  ✔ 400"

echo
echo "✔ Listo. Verificá en el dashboard de Stripe (modo test) que hay UNA sola suscripción para"
echo "  este cliente y que no se va a cancelar al fin del período."

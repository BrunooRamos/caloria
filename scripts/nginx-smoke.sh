#!/usr/bin/env bash
# Prueba infra/nginx con Docker, armado como en infra/docker-compose.yml: el template, el certificado
# temporal de tls-init y el cambio a uno "de Let's Encrypt" sin reiniciar nginx. Chequea la
# redirección del 80, el desafío ACME, TLS 1.2/1.3 y HSTS, los límites de POST /api/v1/meals, el
# rate limit de /auth por cliente detrás del túnel (8443) y el rate limit por IP de la API (RNF-07).
# El Front es un stub que responde 202. Uso: npm run nginx:smoke (o bash scripts/nginx-smoke.sh)
set -euo pipefail

# Mismas imágenes que infra/docker-compose.yml.
IMAGE="${NGINX_IMAGE:-nginx:alpine}"
CERTBOT_IMAGE="${CERTBOT_IMAGE:-certbot/certbot:v5.9.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NGINX_DIR="$ROOT/infra/nginx"
DOMAIN=caloria.test
ID="caloria-nginx-smoke-$$"
TMP="$(mktemp -d)"

cleanup() {
  docker rm -f "$ID-nginx" "$ID-front" >/dev/null 2>&1 || true
  docker network rm "$ID" >/dev/null 2>&1 || true
  docker volume rm "$ID-bootstrap" "$ID-letsencrypt" "$ID-webroot" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
  echo "✖ $*" >&2
  docker logs "$ID-nginx" 2>&1 | tail -n 20 >&2 || true
  exit 1
}

# Un comando con la imagen de certbot (trae openssl) y los volúmenes de nginx montados.
with_certbot() {
  docker run --rm --network "$ID" \
    -v "$ID-bootstrap:/etc/nginx/bootstrap" -v "$ID-letsencrypt:/etc/letsencrypt" \
    -v "$ID-webroot:/var/www/certbot" --entrypoint sh "$CERTBOT_IMAGE" -c "$1"
}

# Un certificado autofirmado en live/$DOMAIN, como el que deja certbot.
fake_letsencrypt() {
  with_certbot "mkdir -p /etc/letsencrypt/live/$DOMAIN && cd /etc/letsencrypt/live/$DOMAIN &&
    openssl req -x509 -nodes -days 1 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
      -subj /CN=$1 -addext subjectAltName=DNS:$DOMAIN -keyout privkey.pem -out fullchain.pem 2>/dev/null"
}

# El certificado que sirve el 443, en PEM.
served_cert() {
  with_certbot "openssl s_client -connect $ID-nginx:443 -servername $DOMAIN </dev/null 2>/dev/null |
    openssl x509"
}

docker network create "$ID" >/dev/null
docker volume create "$ID-bootstrap" >/dev/null
docker volume create "$ID-letsencrypt" >/dev/null
docker volume create "$ID-webroot" >/dev/null

echo "→ tls-init: certificado temporal"
docker run --rm -e DOMAIN="$DOMAIN" -v "$NGINX_DIR/tls-init.sh:/tls-init.sh:ro" \
  -v "$ID-bootstrap:/etc/nginx/bootstrap" --entrypoint sh "$CERTBOT_IMAGE" /tls-init.sh >/dev/null
with_certbot "cat /etc/nginx/bootstrap/fullchain.pem" >"$TMP/bootstrap.pem"

# Stub del Front: descarta el body y responde 202. Devuelve el X-Forwarded-For que le llegó.
cat >"$TMP/front.conf" <<'EOF'
events {}
http {
  server {
    listen 3000;
    client_max_body_size 0;
    add_header X-Seen-Forwarded-For $http_x_forwarded_for always;
    return 202 '{"mealId":"66f1a0000000000000000099","status":"processing"}';
  }
}
EOF
docker run -d --name "$ID-front" --network "$ID" --network-alias front \
  -v "$TMP/front.conf:/etc/nginx/nginx.conf:ro" "$IMAGE" >/dev/null

# Con el log en warn se ve si nginx escribe el body a un archivo temporal. El certificado se revisa
# cada segundo para no esperar el minuto de producción. dev.conf también, para que pase nginx -t.
docker run -d --name "$ID-nginx" --network "$ID" \
  -p 127.0.0.1::80 -p 127.0.0.1::443 -p 127.0.0.1::8080 -p 127.0.0.1::8443 \
  -e DOMAIN="$DOMAIN" -e HSTS_MAX_AGE=300 -e 'NGINX_ENVSUBST_FILTER=^(DOMAIN|HSTS_MAX_AGE)$' \
  -e TLS_CHECK_INTERVAL=1 \
  -v "$NGINX_DIR/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$NGINX_DIR/api.conf:/etc/nginx/caloria/api.conf:ro" \
  -v "$NGINX_DIR/templates:/etc/nginx/templates:ro" \
  -v "$NGINX_DIR/dev.conf:/etc/nginx/conf.d/caloria-dev.conf:ro" \
  -v "$NGINX_DIR/tls.sh:/docker-entrypoint.d/40-caloria-tls.sh:ro" \
  -v "$ID-bootstrap:/etc/nginx/bootstrap:ro" -v "$ID-letsencrypt:/etc/letsencrypt:ro" \
  -v "$ID-webroot:/var/www/certbot:ro" \
  "$IMAGE" nginx -g "daemon off; error_log stderr warn;" >/dev/null

port() {
  docker port "$ID-nginx" "$1/tcp" | head -n1 | sed 's/.*://'
}
HTTP_PORT="$(port 80)"
HTTPS_PORT="$(port 443)"
DEV_PORT="$(port 8080)"
TUNNEL_PORT="$(port 8443)"
HTTP="http://127.0.0.1:$HTTP_PORT"
HTTPS="https://$DOMAIN:$HTTPS_PORT"
TLS=(--resolve "$DOMAIN:$HTTPS_PORT:127.0.0.1" --resolve "$DOMAIN:$TUNNEL_PORT:127.0.0.1"
  --cacert "$TMP/bootstrap.pem")
for _ in $(seq 1 50); do
  curl -s -o /dev/null "$HTTP/" && break
  sleep 0.2
done

echo "→ nginx -t"
docker exec "$ID-nginx" nginx -t -q || fail "nginx -t falló"

echo "→ HTTP redirige a HTTPS con la misma ruta y query, también un POST"
location="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$HTTP/api/v1/meals?from=2026-10-01&limit=5")"
[ "$location" = "301 https://$DOMAIN/api/v1/meals?from=2026-10-01&limit=5" ] ||
  fail "redirección inesperada: $location"
status="$(curl -s -o /dev/null -w '%{http_code}' -X POST -d x=1 "$HTTP/api/v1/meals")"
[ "$status" = 301 ] || fail "un POST por HTTP no redirigió: $status"

echo "→ el desafío ACME se sirve por el 80, sin redirigir"
with_certbot "mkdir -p /var/www/certbot/.well-known/acme-challenge &&
  echo token-smoke > /var/www/certbot/.well-known/acme-challenge/token-smoke"
body="$(curl -s -w '%{http_code}' "$HTTP/.well-known/acme-challenge/token-smoke" | tr -d '\n')"
[ "$body" = "token-smoke200" ] || fail "el desafío respondió: $body"
status="$(curl -s -o /dev/null -w '%{http_code}' "$HTTP/.well-known/acme-challenge/no-existe")"
[ "$status" = 404 ] || fail "un desafío inexistente respondió $status y no 404"

echo "→ HTTPS con el certificado temporal, HSTS corto y sin preload"
curl -s -o /dev/null -D "$TMP/headers" "${TLS[@]}" "$HTTPS/" || fail "no conecta por HTTPS"
grep -qi '^strict-transport-security: max-age=300' "$TMP/headers" || fail "falta HSTS: $(cat "$TMP/headers")"
if grep -qiE '^strict-transport-security:.*(preload|includesubdomains)' "$TMP/headers"; then
  fail "HSTS no tiene que llevar preload ni includeSubDomains todavía"
fi

# Con openssl s_client en un contenedor: el curl de macOS no deja elegir TLS 1.3.
# $1: versión (1_1, 1_2, 1_3). $2: opciones extra.
handshake() {
  with_certbot "openssl s_client -connect $ID-nginx:443 -servername $DOMAIN -tls$1 ${2:-} \
    </dev/null 2>&1" || true
}

echo "→ TLS 1.2 y 1.3 sí; TLS 1.1 no"
grep -q "Protocol: TLSv1.2" <<<"$(handshake 1_2)" || fail "TLS 1.2 no conecta"
grep -q "Protocol: TLSv1.3" <<<"$(handshake 1_3)" || fail "TLS 1.3 no conecta"
# SECLEVEL=0 para que el cliente ofrezca TLS 1.1: el rechazo tiene que venir de nginx.
tls11="$(handshake 1_1 "-cipher DEFAULT:@SECLEVEL=0")"
grep -q "alert protocol version" <<<"$tls11" || fail "TLS 1.1 no fue rechazado por nginx: $tls11"

# $1: tamaño del archivo en bytes. Deja el status en $STATUS, headers y body en $TMP.
post_meal() {
  head -c "$1" /dev/zero >"$TMP/photo.bin"
  STATUS="$(curl -s -o "$TMP/body" -D "$TMP/headers" -w '%{http_code}' "${TLS[@]}" \
    -F "photo=@$TMP/photo.bin;type=image/jpeg" "$HTTPS/api/v1/meals")"
}

LIMIT=$((13 * 1024 * 1024))

echo "→ POST de más de 13 MB → 413 PAYLOAD_TOO_LARGE, con HSTS"
post_meal $((LIMIT + 1))
[ "$STATUS" = 413 ] || fail "esperaba 413 y vino $STATUS: $(cat "$TMP/body")"
grep -q '"code":"PAYLOAD_TOO_LARGE"' "$TMP/body" || fail "body inesperado: $(cat "$TMP/body")"
header_id="$(grep -i '^x-request-id:' "$TMP/headers" | sed 's/^[^:]*: *//' | tr -d '\r')"
body_id="$(sed -n 's/.*"requestId":"\([^"]*\)".*/\1/p' "$TMP/body")"
[[ "$header_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] ||
  fail "X-Request-Id no es un UUID: '$header_id'"
[ "$header_id" = "$body_id" ] || fail "requestId '$body_id' ≠ X-Request-Id '$header_id'"
grep -qi '^strict-transport-security: max-age=300' "$TMP/headers" || fail "el 413 no lleva HSTS"

echo "→ POST chico → pasa al Front"
post_meal 1024
[ "$STATUS" = 202 ] || fail "esperaba 202 y vino $STATUS: $(cat "$TMP/body")"

echo "→ POST de 12 MB → pasa al Front sin escribir el body a disco"
post_meal $((12 * 1024 * 1024))
[ "$STATUS" = 202 ] || fail "esperaba 202 y vino $STATUS: $(cat "$TMP/body")"
if docker logs "$ID-nginx" 2>&1 | grep -q "buffered to a temporary file"; then
  fail "nginx escribió el body a un archivo temporal"
fi

echo "→ dev.conf: la API por HTTP en el 8080, sin redirigir ni HSTS"
status="$(curl -s -o /dev/null -D "$TMP/headers" -w '%{http_code}' -X POST -d x=1 \
  "http://127.0.0.1:$DEV_PORT/api/v1/meals")"
[ "$status" = 202 ] || fail "el 8080 respondió $status"
if grep -qi '^strict-transport-security' "$TMP/headers"; then fail "el 8080 manda HSTS"; fi

# $1: base URL. $2: CF-Connecting-IP. Deja el status en $STATUS y los headers en $TMP/headers.
login() {
  STATUS="$(curl -s -o /dev/null -D "$TMP/headers" -w '%{http_code}' "${TLS[@]}" \
    -H "CF-Connecting-IP: $2" -X POST -d x=1 "$1/api/v1/auth/login")"
}

# /auth admite 10 por minuto con burst de 5: el séptimo seguido de la misma IP ya es 429.
echo "→ túnel (8443): el rate limit de /auth es por cliente (CF-Connecting-IP)"
TUNNEL="https://$DOMAIN:$TUNNEL_PORT"
for i in $(seq 1 10); do
  login "$TUNNEL" "198.51.100.$i"
  [ "$STATUS" = 202 ] || fail "el cliente $i del túnel recibió $STATUS: comparten el rate limit"
done
grep -qi '^x-seen-forwarded-for: .*198\.51\.100\.10[[:space:]]*$' "$TMP/headers" ||
  fail "el Front no recibió la IP del cliente al final de X-Forwarded-For: $(cat "$TMP/headers")"
grep -qi '^strict-transport-security: max-age=300' "$TMP/headers" || fail "el 8443 no manda HSTS"
for _ in $(seq 1 7); do login "$TUNNEL" 198.51.100.200; done
[ "$STATUS" = 429 ] || fail "el túnel no limitó a un mismo cliente: $STATUS"

echo "→ 443: CF-Connecting-IP se ignora (no se puede esquivar el rate limit falseándolo)"
for i in $(seq 1 7); do login "$HTTPS" "203.0.113.$i"; done
[ "$STATUS" = 429 ] || fail "el 443 le creyó a CF-Connecting-IP: $STATUS"

# $1: CN esperado. Espera hasta 10 s a que nginx sirva ese certificado.
wait_for_cert() {
  for _ in $(seq 1 20); do
    served_cert | openssl x509 -noout -subject 2>/dev/null | grep -q "CN *= *$1" && return 0
    sleep 0.5
  done
  fail "nginx no pasó al certificado $1"
}

master_pid() {
  docker exec "$ID-nginx" cat /var/run/nginx.pid
}

echo "→ aparece el certificado de Let's Encrypt: nginx recarga sin reiniciar"
pid="$(master_pid)"
fake_letsencrypt emitido
wait_for_cert emitido
[ "$(master_pid)" = "$pid" ] || fail "nginx se reinició (el PID cambió)"

echo "→ certbot lo renueva: nginx toma el nuevo"
fake_letsencrypt renovado
wait_for_cert renovado
[ "$(master_pid)" = "$pid" ] || fail "nginx se reinició (el PID cambió)"
docker logs "$ID-nginx" 2>&1 | grep -q "nginx recargó" || fail "no está el log de la recarga"

# Al final: estas ráfagas agotan los límites de la IP del host para el resto del script.
# $1: método. $2: ruta. Deja el status en $STATUS, headers y body en $TMP.
dev_request() {
  STATUS="$(curl -s -o "$TMP/body" -D "$TMP/headers" -w '%{http_code}' -X "$1" -d x=1 \
    "http://127.0.0.1:$DEV_PORT$2")"
}

# Subidas: 20 por minuto con burst de 10. Ya hubo algunas arriba, así que el 429 llega antes.
echo "→ POST /meals en ráfaga desde la misma IP → 429 RATE_LIMITED con Retry-After"
accepted=0
for _ in $(seq 1 20); do
  dev_request POST /api/v1/meals
  [ "$STATUS" = 429 ] && break
  [ "$STATUS" = 202 ] || fail "POST /meals respondió $STATUS"
  accepted=$((accepted + 1))
done
[ "$STATUS" = 429 ] || fail "20 POST /meals seguidos y ninguno dio 429"
[ "$accepted" -le 11 ] || fail "pasaron $accepted POST /meals seguidos (burst 10)"
grep -q '"code":"RATE_LIMITED"' "$TMP/body" || fail "body inesperado: $(cat "$TMP/body")"
grep -qi '^retry-after: 30' "$TMP/headers" || fail "falta Retry-After: $(cat "$TMP/headers")"
echo "  $accepted aceptados y después 429, Retry-After: 30"

echo "→ GET /meals (historial) no gasta el límite de subidas"
dev_request GET "/api/v1/meals?from=2026-10-01"
[ "$STATUS" = 202 ] || fail "GET /meals respondió $STATUS con las subidas agotadas"

# Toda la API: 10 por segundo con burst de 40.
echo "→ cualquier ruta en ráfaga desde la misma IP → 429 con Retry-After"
for _ in $(seq 1 80); do
  dev_request GET /api/v1/users/me
  [ "$STATUS" = 429 ] && break
done
[ "$STATUS" = 429 ] || fail "80 GET seguidos y ninguno dio 429"
grep -q '"code":"RATE_LIMITED"' "$TMP/body" || fail "body inesperado: $(cat "$TMP/body")"
grep -qi '^retry-after: 5' "$TMP/headers" || fail "falta Retry-After: $(cat "$TMP/headers")"

echo "✔ nginx OK"

#!/usr/bin/env bash
# Prueba infra/nginx/nginx.conf con Docker: `nginx -t` y un smoke test de POST /api/v1/meals.
# El Front es un stub que responde 202. Uso: npm run nginx:smoke (o bash scripts/nginx-smoke.sh)
set -euo pipefail

# Misma imagen que infra/docker-compose.yml.
IMAGE="${NGINX_IMAGE:-nginx:alpine}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF="$ROOT/infra/nginx/nginx.conf"
ID="caloria-nginx-smoke-$$"
TMP="$(mktemp -d)"

cleanup() {
  docker rm -f "$ID-nginx" "$ID-front" >/dev/null 2>&1 || true
  docker network rm "$ID" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
  echo "✖ $*" >&2
  exit 1
}

echo "→ nginx -t"
docker run --rm --add-host front:127.0.0.1 -v "$CONF:/etc/nginx/nginx.conf:ro" \
  --entrypoint nginx "$IMAGE" -t

# Stub del Front: descarta el body y responde 202.
cat >"$TMP/front.conf" <<'EOF'
events {}
http {
  server {
    listen 3000;
    client_max_body_size 0;
    return 202 '{"mealId":"66f1a0000000000000000099","status":"processing"}';
  }
}
EOF

docker network create "$ID" >/dev/null
docker run -d --name "$ID-front" --network "$ID" --network-alias front \
  -v "$TMP/front.conf:/etc/nginx/nginx.conf:ro" "$IMAGE" >/dev/null
# Con el log en warn se ve si nginx escribe el body a un archivo temporal.
docker run -d --name "$ID-nginx" --network "$ID" -p 127.0.0.1::80 \
  -v "$CONF:/etc/nginx/nginx.conf:ro" "$IMAGE" \
  nginx -g "daemon off; error_log stderr warn;" >/dev/null

PORT="$(docker port "$ID-nginx" 80/tcp | head -n1 | sed 's/.*://')"
URL="http://127.0.0.1:$PORT/api/v1/meals"
for _ in $(seq 1 50); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 0.2
done

# $1: tamaño del archivo en bytes. Deja el status en $STATUS, headers y body en $TMP.
post_meal() {
  head -c "$1" /dev/zero >"$TMP/photo.bin"
  STATUS="$(curl -s -o "$TMP/body" -D "$TMP/headers" -w '%{http_code}' \
    -F "photo=@$TMP/photo.bin;type=image/jpeg" "$URL")"
}

LIMIT=$((13 * 1024 * 1024))

echo "→ POST de más de 13 MB → 413 PAYLOAD_TOO_LARGE"
post_meal $((LIMIT + 1))
[ "$STATUS" = 413 ] || fail "esperaba 413 y vino $STATUS: $(cat "$TMP/body")"
grep -q '"code":"PAYLOAD_TOO_LARGE"' "$TMP/body" || fail "body inesperado: $(cat "$TMP/body")"
header_id="$(grep -i '^x-request-id:' "$TMP/headers" | sed 's/^[^:]*: *//' | tr -d '\r')"
body_id="$(sed -n 's/.*"requestId":"\([^"]*\)".*/\1/p' "$TMP/body")"
[[ "$header_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] ||
  fail "X-Request-Id no es un UUID: '$header_id'"
[ "$header_id" = "$body_id" ] || fail "requestId '$body_id' ≠ X-Request-Id '$header_id'"

echo "→ POST chico → pasa al Front"
post_meal 1024
[ "$STATUS" = 202 ] || fail "esperaba 202 y vino $STATUS: $(cat "$TMP/body")"

echo "→ POST de 12 MB → pasa al Front sin escribir el body a disco"
post_meal $((12 * 1024 * 1024))
[ "$STATUS" = 202 ] || fail "esperaba 202 y vino $STATUS: $(cat "$TMP/body")"
if docker logs "$ID-nginx" 2>&1 | grep -q "buffered to a temporary file"; then
  fail "nginx escribió el body a un archivo temporal"
fi

echo "✔ nginx OK"

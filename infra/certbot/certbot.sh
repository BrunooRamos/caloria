#!/bin/sh
# Servicio certbot (perfil letsencrypt): pide el certificado de $DOMAIN la primera vez, validando por
# HTTP con webroot, y después lo renueva cada 12 h. nginx lo toma solo (infra/nginx/tls.sh).
#
# LETSENCRYPT_STAGING=1 (el default) usa el entorno de staging, que tiene límites mucho más altos
# pero emite certificados que ningún cliente acepta. Para el certificado real, LETSENCRYPT_STAGING=0.
# ACME_SERVER usa otro servidor ACME (por ejemplo Pebble, para probar sin dominio).
set -eu

: "${DOMAIN:?Falta DOMAIN}"
: "${LETSENCRYPT_EMAIL:?Falta LETSENCRYPT_EMAIL}"

WEBROOT=/var/www/certbot
CHALLENGE_DIR="$WEBROOT/.well-known/acme-challenge"
RENEWAL_CONF="/etc/letsencrypt/renewal/$DOMAIN.conf"
if [ "${LETSENCRYPT_STAGING:-1}" = 0 ]; then
  SERVER=https://acme-v02.api.letsencrypt.org/directory
else
  SERVER=https://acme-staging-v02.api.letsencrypt.org/directory
fi
SERVER="${ACME_SERVER:-$SERVER}"

log() {
  echo "certbot.sh: $*"
}

# Hay certificado y es del servidor pedido (si se pasa de staging a producción, hay que pedir otro).
has_cert() {
  [ -f "$RENEWAL_CONF" ] && grep -qxF "server = $SERVER" "$RENEWAL_CONF"
}

# Antes de llamar a Let's Encrypt, comprueba que http://$DOMAIN/.well-known/acme-challenge/ llegue
# a este nginx. Un DNS mal configurado no gasta intentos fallidos (Let's Encrypt corta a los 5 por
# hora y por dominio).
reachable() {
  token="preflight-$(date +%s)-$$"
  mkdir -p "$CHALLENGE_DIR"
  echo "$token" >"$CHALLENGE_DIR/$token"
  got=$(wget -q -T 10 -O - "http://$DOMAIN/.well-known/acme-challenge/$token" 2>/dev/null || true)
  rm -f "$CHALLENGE_DIR/$token"
  [ "$got" = "$token" ]
}

issue() {
  # Si ya había uno de otro servidor, se reemplaza (--break-my-certs: si es de producción a staging).
  replace=""
  [ -f "$RENEWAL_CONF" ] && replace="--force-renewal --break-my-certs"
  # shellcheck disable=SC2086
  certbot certonly --webroot -w "$WEBROOT" \
    -d "$DOMAIN" --cert-name "$DOMAIN" \
    --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email \
    --non-interactive --server "$SERVER" $replace
}

until has_cert; do
  if ! reachable; then
    log "http://$DOMAIN/.well-known/acme-challenge/ no llega a este nginx (DNS o puerto 80). Reintento en 1 min."
    sleep 60
    continue
  fi
  if issue; then
    log "certificado emitido por $SERVER"
    break
  fi
  # Cada 15 min: no más de 4 intentos fallidos por hora.
  log "no se pudo emitir el certificado. Reintento en 15 min."
  sleep 900
done

while :; do
  # renew solo renueva cuando falta poco para el vencimiento; con eso, dos chequeos por día alcanzan.
  certbot renew --quiet || log "ERROR: certbot renew falló; reintenta en 12 h"
  sleep 43200
done

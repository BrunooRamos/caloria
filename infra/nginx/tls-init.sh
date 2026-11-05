#!/bin/sh
# Servicio tls-init: deja un certificado autofirmado para $DOMAIN en /etc/nginx/bootstrap (volumen
# tls-bootstrap) y termina. Es el que usa nginx para poder arrancar mientras no haya uno de Let's
# Encrypt, y el que verifica el túnel (perfil tunnel). Corre con la imagen de certbot porque la de
# nginx no trae openssl. Si ya hay uno para el mismo dominio con más de 30 días, no hace nada.
set -eu

: "${DOMAIN:?Falta DOMAIN}"
DIR=/etc/nginx/bootstrap

if [ -s "$DIR/fullchain.pem" ] && [ -s "$DIR/privkey.pem" ] &&
  [ "$(cat "$DIR/domain" 2>/dev/null)" = "$DOMAIN" ] &&
  openssl x509 -checkend $((30 * 24 * 3600)) -noout -in "$DIR/fullchain.pem" >/dev/null; then
  echo "tls-init: ya hay un certificado temporal para $DOMAIN"
  exit 0
fi

case "$DOMAIN" in
  *[!0-9.]*) SAN="DNS:$DOMAIN" ;;
  *) SAN="IP:$DOMAIN" ;;
esac

umask 077
openssl req -x509 -nodes -days 90 \
  -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -subj "/CN=$DOMAIN" -addext "subjectAltName=$SAN" \
  -keyout "$DIR/privkey.pem.tmp" -out "$DIR/fullchain.pem.tmp" 2>/dev/null
# El certificado es público (lo lee cloudflared con otro usuario); la clave no.
chmod 644 "$DIR/fullchain.pem.tmp"
mv "$DIR/privkey.pem.tmp" "$DIR/privkey.pem"
mv "$DIR/fullchain.pem.tmp" "$DIR/fullchain.pem"
echo "$DOMAIN" >"$DIR/domain"
echo "tls-init: certificado temporal autofirmado para $DOMAIN (90 días)"

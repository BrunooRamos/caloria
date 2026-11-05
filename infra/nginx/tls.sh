#!/bin/sh
# Corre en el contenedor de nginx antes de que arranque (/docker-entrypoint.d/). Elige qué
# certificado sirve y deja un loop que recarga nginx cuando ese certificado cambia.
#
# nginx nunca apunta directo a Let's Encrypt: usa /etc/nginx/tls/{fullchain,privkey}.pem, symlinks
# al primero que exista de:
#   1. /etc/letsencrypt/live/$DOMAIN    el de Let's Encrypt (volumen letsencrypt, lo escribe certbot)
#   2. /etc/nginx/certs/local           uno propio, por ejemplo de mkcert (infra/certs/local)
#   3. /etc/nginx/bootstrap             el autofirmado temporal de tls-init
# Así nginx arranca aunque todavía no haya certificado real, y certbot lo pide con nginx levantado.
set -eu

ME=$(basename "$0")
: "${DOMAIN:?Falta DOMAIN}"
INTERVAL="${TLS_CHECK_INTERVAL:-60}"
TLS_DIR=/etc/nginx/tls

log() {
  echo "$ME: $*"
}

pick() {
  for dir in "/etc/letsencrypt/live/$DOMAIN" /etc/nginx/certs/local /etc/nginx/bootstrap; do
    if [ -s "$dir/fullchain.pem" ] && [ -s "$dir/privkey.pem" ]; then
      echo "$dir"
      return 0
    fi
  done
  return 1
}

# El directorio y el contenido: certbot renueva cambiando a dónde apuntan sus symlinks.
state() {
  echo "$1 $(cat "$1/fullchain.pem" "$1/privkey.pem" | sha256sum)"
}

link() {
  mkdir -p "$TLS_DIR"
  ln -sfn "$1/fullchain.pem" "$TLS_DIR/fullchain.pem"
  ln -sfn "$1/privkey.pem" "$TLS_DIR/privkey.pem"
}

# `nginx -s reload` es gradual: workers nuevos con el certificado nuevo y los viejos terminan sus
# conexiones. Si la configuración no pasa `nginx -t`, sigue sirviendo la anterior.
watch() {
  # Un error suelto (un archivo que certbot está reemplazando) no tiene que matar el loop.
  set +e
  current="$1"
  while sleep "$INTERVAL"; do
    dir=$(pick) || continue
    next=$(state "$dir") || continue
    [ "$next" = "$current" ] && continue
    link "$dir"
    if nginx -t -q && nginx -s reload; then
      log "certificado nuevo en $dir: nginx recargó"
      current="$next"
    else
      log "ERROR: el certificado de $dir no pasa nginx -t; sigue el anterior"
      link "${current%% *}"
    fi
  done
}

dir=$(pick) || {
  log "ERROR: no hay ningún certificado (¿corrió tls-init?)"
  exit 1
}
link "$dir"
log "sirve el certificado de $dir"
watch "$(state "$dir")" &

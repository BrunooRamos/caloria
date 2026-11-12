#!/usr/bin/env bash
# Genera la CA propia y los certificados del mTLS entre el Front Service y el Backend (RNF-03).
#
# Uso: npm run certs:generate [-- <carpeta>] [-- --force]
# Por defecto escribe en infra/certs/mtls (en .gitignore), que es de donde los monta docker compose:
#
#   ca/ca.pem, ca/ca-key.pem          la CA. La clave de la CA no se monta en ningún contenedor.
#   back/{ca,cert,key}.pem            el Backend: servidor TLS (CN caloria-back, SAN back y localhost)
#   front/{ca,cert,key}.pem           el Front: cliente TLS (CN caloria-front)
#
# Requiere openssl (o LibreSSL, el de macOS).
set -euo pipefail

FORCE=0
OUT=""
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -*) echo "✖ Opción desconocida: $arg" >&2; exit 1 ;;
    *) OUT="$arg" ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${OUT:-$REPO_ROOT/infra/certs/mtls}"
DAYS_CA=3650
DAYS_LEAF=825

command -v openssl >/dev/null || { echo "✖ Falta openssl en el PATH" >&2; exit 1; }

if [ -e "$OUT/ca/ca.pem" ] && [ "$FORCE" -ne 1 ]; then
  echo "✖ Ya hay certificados en $OUT. Usá --force para regenerarlos (Front y Backend juntos)." >&2
  exit 1
fi

umask 077
mkdir -p "$OUT/ca" "$OUT/back" "$OUT/front"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

ec_key() { openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out "$1"; }

# CA: solo firma certificados (pathlen 0: no puede crear otras CA).
cat >"$TMP/ca.ext" <<'EOF'
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
EOF
ec_key "$OUT/ca/ca-key.pem"
openssl req -new -key "$OUT/ca/ca-key.pem" -subj "/O=CalorIA/CN=CalorIA mTLS CA" -out "$TMP/ca.csr"
openssl x509 -req -in "$TMP/ca.csr" -signkey "$OUT/ca/ca-key.pem" -days "$DAYS_CA" -sha256 \
  -extfile "$TMP/ca.ext" -out "$OUT/ca/ca.pem" 2>/dev/null

# $1 = carpeta (back|front), $2 = CN, $3 = extensiones
leaf() {
  local name="$1" cn="$2"
  printf '%s\n' "$3" >"$TMP/$name.ext"
  ec_key "$OUT/$name/key.pem"
  openssl req -new -key "$OUT/$name/key.pem" -subj "/O=CalorIA/CN=$cn" -out "$TMP/$name.csr"
  openssl x509 -req -in "$TMP/$name.csr" -CA "$OUT/ca/ca.pem" -CAkey "$OUT/ca/ca-key.pem" \
    -set_serial "0x$(openssl rand -hex 16)" -days "$DAYS_LEAF" -sha256 \
    -extfile "$TMP/$name.ext" -out "$OUT/$name/cert.pem" 2>/dev/null
  cp "$OUT/ca/ca.pem" "$OUT/$name/ca.pem"
}

# Backend: solo puede actuar de servidor. Los SAN son los nombres con los que el Front lo llama.
leaf back caloria-back "basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = DNS:back, DNS:localhost, IP:127.0.0.1"

# Front: solo puede actuar de cliente.
leaf front caloria-front "basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = clientAuth"

# Las claves quedan 600 (los contenedores corren como root y las leen igual); certificados, 644.
chmod 755 "$OUT" "$OUT/back" "$OUT/front"
chmod 700 "$OUT/ca"
chmod 600 "$OUT"/*/*key.pem
chmod 644 "$OUT"/*/ca.pem "$OUT"/back/cert.pem "$OUT"/front/cert.pem

openssl verify -CAfile "$OUT/ca/ca.pem" "$OUT/back/cert.pem" "$OUT/front/cert.pem" >/dev/null

cat <<EOF
✔ CA propia y certificados del mTLS en $OUT
    ca/ca-key.pem     clave de la CA: firma los certificados. No se monta en ningún contenedor
    back/             Backend (servidor, CN caloria-back): ca.pem, cert.pem, key.pem
    front/            Front Service (cliente, CN caloria-front): ca.pem, cert.pem, key.pem

docker compose ya los monta desde infra/certs/mtls. Vencen en $DAYS_LEAF días: para renovarlos,
volvé a correr con --force y reiniciá front y back.
EOF

# certs

Nada de lo que hay acá se sube al repo salvo este README (`infra/certs/*` está en `.gitignore`).

- **`local/`** (opcional): un certificado propio para nginx, por ejemplo de mkcert, como `local/fullchain.pem` y `local/privkey.pem`. nginx lo usa si no hay uno de Let's Encrypt (ver "HTTPS" en el README).
- **`mtls/`**: la CA propia y los certificados del mTLS Front → Back (:4000). Se generan con `npm run certs:generate` en la raíz. `ca/` tiene la clave de la CA y no se monta en ningún contenedor; `front/` se monta solo en el Front y `back/` solo en el Backend. nginx no ve ninguno de los dos (solo monta `local/`).

Los certificados de Let's Encrypt **no** van acá: viven en el volumen de Docker `letsencrypt`, y el temporal de arranque en `tls-bootstrap`.

# certs

Nada de lo que hay acá se sube al repo salvo este README (`infra/certs/*` está en `.gitignore`).

- **`local/`** (opcional): un certificado propio para nginx, por ejemplo de mkcert, como `local/fullchain.pem` y `local/privkey.pem`. nginx lo usa si no hay uno de Let's Encrypt (ver "HTTPS" en el README).
- **mTLS Front → Back (:4000):** acá irían la CA interna y los certificados de esa conexión, todavía pendiente (decisión abierta 9).

Los certificados de Let's Encrypt **no** van acá: viven en el volumen de Docker `letsencrypt`, y el temporal de arranque en `tls-bootstrap`.

# front-service — Capa 2 · DMZ · :3000

Cara pública de `/api/v1` detrás de nginx: verifica el JWT con la clave pública (solo RS256), valida y sanitiza con zod, rechaza 400/401/413 y reenvía al Back Service lo validado. Devuelve la respuesta del Backend tal cual.
No tiene `models/` ni `jobs/` a propósito: no tiene base de datos, ni claves de IA, ni clave privada.

## Variables de entorno

Se validan con zod al arrancar (`src/config`): si falta o sobra algo, el servicio no arranca. Los errores nombran la variable, nunca su valor.

| Variable             | Obligatoria | Default | Qué es                                                                                            |
| -------------------- | :---------: | ------- | ------------------------------------------------------------------------------------------------- |
| `JWT_PUBLIC_KEY`     |      ✔      | —       | Clave pública RSA ≥ 2048 en PEM (con `\n` reales o escapados). Si le pasás la privada, no arranca |
| `BACKEND_URL`        |      ✔      | —       | URL del Back Service, solo `https://` (mTLS)                                                      |
| `MTLS_CA_FILE`       |      ✔      | —       | Ruta a la CA propia (`infra/certs/mtls/front/ca.pem`). Con ella verifica al Backend               |
| `MTLS_CERT_FILE`     |      ✔      | —       | Ruta al certificado de cliente del Front (CN `caloria-front`)                                     |
| `MTLS_KEY_FILE`      |      ✔      | —       | Ruta a su clave privada                                                                           |
| `PORT`               |             | `3000`  |                                                                                                   |
| `BACKEND_TIMEOUT_MS` |             | `10000` | Timeout de cada llamada al Backend (100 a 60000). Al vencer → 503 `SERVICE_UNAVAILABLE`           |
| `LOG_LEVEL`          |             | `info`  | Lo lee el logger de `@caloria/shared`                                                             |

Si el entorno trae `JWT_PRIVATE_KEY`, `MONGO_URI`, `REDIS_URL` o `OPENAI_API_KEY`, el servicio no arranca: el Front nunca tiene que recibirlos.

## Correr local

```sh
npm ci
export JWT_PUBLIC_KEY="$(cat ~/.caloria/jwt/jwt-public.pem)"   # npm run keys:generate en la raíz
export BACKEND_URL=https://localhost:4000
export MTLS_CA_FILE=../infra/certs/mtls/front/ca.pem      # npm run certs:generate en la raíz
export MTLS_CERT_FILE=../infra/certs/mtls/front/cert.pem
export MTLS_KEY_FILE=../infra/certs/mtls/front/key.pem
npm run dev
```

`npm test` levanta un Backend falso en un puerto libre: no hace falta Mongo ni el Backend real.

## Cómo reenvía

- Las rutas están en una tabla (`src/routes`): register, login y refresh son públicas; logout, `/users/me`, `GET /meals/:id` y `PATCH /meals/:id` piden JWT. `POST /meals` va aparte porque es multipart.
- Los params de la ruta (`:id`) se validan con zod y se reenvían ya validados, con `encodeURIComponent`.
- Con JWT, primero se verifica el token (sin token o inválido → 401 `UNAUTHORIZED`, vencido → 401 `TOKEN_EXPIRED`) y después se valida la entrada.
- Al Backend van el mismo método, ruta y query, el body ya validado, el `Authorization` original (el Backend lo re-verifica) y el `X-Request-Id` que generó el Front.
- De la respuesta pasan status, body, `Content-Type`, `Retry-After` y `Cache-Control`.
- `trust proxy` está en 1: `req.ip` es la IP que agrega nginx al final de `X-Forwarded-For`.

## mTLS hacia el Backend

El Backend solo atiende por HTTPS con mTLS (ver `docs/arquitectura.md`, "mTLS entre Front y Backend"). `src/index.ts` le pasa al cliente (`src/clients/backend.ts`) un `Agent` de undici con la CA propia, el certificado del Front y su clave: presenta el certificado y solo confía en un Backend firmado por la misma CA. Si el handshake falla, el cliente responde 503 `SERVICE_UNAVAILABLE`, como con cualquier error de conexión.

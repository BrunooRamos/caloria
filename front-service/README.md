# front-service — Capa 2 · DMZ · :3000

Cara pública de `/api/v1` detrás de nginx: verifica el JWT con la clave pública (solo RS256), valida y sanitiza con zod, rechaza 400/401/413 y reenvía al Back Service lo validado. Devuelve la respuesta del Backend tal cual.
No tiene `models/` ni `jobs/` a propósito: no tiene base de datos, ni claves de IA, ni clave privada.

## Variables de entorno

Se validan con zod al arrancar (`src/config`): si falta o sobra algo, el servicio no arranca. Los errores nombran la variable, nunca su valor.

| Variable             | Obligatoria | Default | Qué es                                                                                            |
| -------------------- | :---------: | ------- | ------------------------------------------------------------------------------------------------- |
| `JWT_PUBLIC_KEY`     |      ✔      | —       | Clave pública RSA ≥ 2048 en PEM (con `\n` reales o escapados). Si le pasás la privada, no arranca |
| `BACKEND_URL`        |      ✔      | —       | URL del Back Service, `http://` o `https://`                                                      |
| `PORT`               |             | `3000`  |                                                                                                   |
| `BACKEND_TIMEOUT_MS` |             | `10000` | Timeout de cada llamada al Backend (100 a 60000). Al vencer → 503 `SERVICE_UNAVAILABLE`           |
| `LOG_LEVEL`          |             | `info`  | Lo lee el logger de `@caloria/shared`                                                             |

Si el entorno trae `JWT_PRIVATE_KEY`, `MONGO_URI`, `REDIS_URL` o `OPENAI_API_KEY`, el servicio no arranca: el Front nunca tiene que recibirlos.

## Correr local

```sh
npm ci
export JWT_PUBLIC_KEY="$(cat ~/.caloria/jwt/jwt-public.pem)"   # npm run keys:generate en la raíz
export BACKEND_URL=http://localhost:4000
npm run dev
```

`npm test` levanta un Backend falso en un puerto libre: no hace falta Mongo ni el Backend real.

## Cómo reenvía

- Las rutas están en una tabla (`src/routes`): register, login y refresh son públicas; logout y `/users/me` piden JWT.
- Con JWT, primero se verifica el token (sin token o inválido → 401 `UNAUTHORIZED`, vencido → 401 `TOKEN_EXPIRED`) y después se valida la entrada.
- Al Backend van el mismo método, ruta y query, el body ya validado, el `Authorization` original (el Backend lo re-verifica) y el `X-Request-Id` que generó el Front.
- De la respuesta pasan status, body, `Content-Type`, `Retry-After` y `Cache-Control`.
- `trust proxy` está en 1: `req.ip` es la IP que agrega nginx al final de `X-Forwarded-For`.

## mTLS hacia el Backend (pendiente)

Es una decisión abierta (`docs/requerimientos.md`, decisión 9). El cliente (`src/clients/backend.ts`) ya acepta un `dispatcher` de undici, que es como el `fetch` de Node configura TLS. Para activarlo:

1. `npm install undici` (la versión cuyo major coincida con el undici de Node).
2. Sumar tres variables al esquema de `src/config` (CA, certificado y clave del Front) y montarlas como secretos.
3. En `src/index.ts`: `createBackendClient({ ..., dispatcher: new Agent({ connect: { ca, cert, key } }) })`.
4. `BACKEND_URL=https://back:4000`, y que el Backend exija certificado de cliente.

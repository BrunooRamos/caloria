# back-service — Capa 3 · Red segura · :4000

Lógica de negocio, MongoDB, Redis (cola) y worker de IA (`src/worker.ts`). Firma los JWT con RS256 (clave privada).

## Cola de análisis (Redis + BullMQ)

`POST /meals` encola en la cola `meal-analysis` (`src/jobs/meal-analysis.ts`) un job `{ mealId, requestId }` con `jobId = mealId`, 4 intentos y backoff exponencial. Config en `REDIS_URL` (obligatoria).

Los tests de la cola y del worker corren contra un Redis real y se saltean si no está `REDIS_TEST_URL`. El override de dev publica el Redis del compose en `127.0.0.1:6379`:

```sh
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d redis
REDIS_TEST_URL=redis://127.0.0.1:6379 npm test
```

## Worker de análisis

`src/worker.ts` consume la cola `meal-analysis` con un Worker de BullMQ (`src/jobs/meal-analysis-worker.ts`). Usa su propia config (`src/config/worker.ts`): `MONGO_URI`, `REDIS_URL`, `S3_*`, `OPENAI_API_KEY` (obligatoria), `OPENAI_VISION_MODEL` (por defecto `gpt-6-luna`) y `WORKER_CONCURRENCY` (entero positivo, por defecto 2; cualquier otro valor no arranca). No recibe `JWT_PRIVATE_KEY`, y el Back (`loadConfig`) no recibe la clave de OpenAI.

Al arrancar lee una sola vez el prompt `prompts/analisis-comida.md` (`src/config/analysis-prompt.ts`): el frontmatter tiene `autor`, `version` y `fecha`, y el cuerpo es el prompt de sistema. `version` es el `promptVersion` que se guarda en cada meal. Si falta el archivo o no tiene versión, el worker no arranca. La imagen de Docker copia ese archivo (`.dockerignore` deja afuera el resto de `prompts/`).

Cada job lo resuelve `src/jobs/meal-analysis-processor.ts`: lee la meal, baja la foto (y el audio) del bucket y se los pasa a `analyze` (`src/jobs/analyze-meal.ts`). Si la meal no existe o ya no está en `processing`, el job termina sin error; si falla Mongo o el bucket, el error se propaga y BullMQ reintenta.

`analyze` pasa la foto HEIC a JPEG (`src/services/vision-image.ts`, con `heic-convert`: libheif en WASM, sin binarios nativos) y llama a la IA (`src/services/vision.ts`). La interfaz `VisionService` recibe la imagen y devuelve el análisis o "no es comida". La implementación de OpenAI usa la Responses API con structured outputs (JSON schema strict), `store: false` y un timeout de 45 s sin reintentos del SDK. La respuesta se valida igual con zod: rangos con `min ≤ max` y sin negativos, y `confidence` entre 0 y 1. Después:

- Si zod la rechaza, lanza: BullMQ reintenta con las opciones de la cola y la meal sigue en `processing`.
- Si es comida, guarda `analysis` con `promptVersion` y `model` y la pasa a `ready`.
- Si no es comida, la pasa a `failed` con `error.code: "NOT_FOOD"`, sin reintento.
- Los dos updates filtran por `status: "processing"`: un job repetido no pisa nada.

Cada job loguea `mealId`, `requestId`, intento y `durationMs`; si falla, el error y `willRetry`. Cada llamada a la IA loguea `model`, `promptVersion`, `durationMs`, `usage` (tokens `input`, `output` y `total`) y `result` (`ready` o `NOT_FOOD`). Si zod rechaza, solo los `issues` (path, código y mensaje): ni la foto, ni la respuesta cruda, ni la nota van al log. Con `SIGTERM`/`SIGINT` cierra el worker (espera los jobs en curso) y después Mongo.

Los tests usan una IA falsa que pasa por el mismo zod, y el service de OpenAI se prueba con un `fetch` falso: ninguno sale a la red.

```sh
npm run dev:worker   # necesita MONGO_URI, REDIS_URL, S3_* y OPENAI_API_KEY en el entorno
```

## Media (storage privado)

`src/services/media.ts` sube, borra y firma URLs (≤ 15 min) sobre un bucket S3-compatible: MinIO en local. Config en `S3_*` (ver `.env.example`); la URL se firma con `S3_PUBLIC_ENDPOINT`, que es el host que alcanza la app, no el interno.

El test de integración corre contra un MinIO real y se saltea si no está `S3_TEST_ENDPOINT`:

```sh
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d minio minio-init
S3_TEST_ENDPOINT=http://localhost:9000 S3_TEST_ACCESS_KEY_ID=<S3_ACCESS_KEY_ID> \
  S3_TEST_SECRET_ACCESS_KEY=<S3_SECRET_ACCESS_KEY> npm test
```

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

`src/worker.ts` consume la cola `meal-analysis` con un Worker de BullMQ (`src/jobs/meal-analysis-worker.ts`). Usa su propia config (`src/config/worker.ts`): `MONGO_URI`, `REDIS_URL`, `S3_*` y `WORKER_CONCURRENCY` (entero positivo, por defecto 2; cualquier otro valor no arranca). No recibe `JWT_PRIVATE_KEY`.

Cada job lo resuelve `src/jobs/meal-analysis-processor.ts`: lee la meal, baja la foto (y el audio) del bucket y se los pasa a `analyze`. Si la meal no existe o ya no está en `processing`, el job termina sin error; si falla Mongo o el bucket, el error se propaga y BullMQ reintenta. Por ahora `analyze` no hace nada y la meal queda en `processing` (la IA es el #18).

Cada job loguea `mealId`, `requestId`, intento y `durationMs`; si falla, el error y `willRetry`. Con `SIGTERM`/`SIGINT` cierra el worker (espera los jobs en curso) y después Mongo.

```sh
npm run dev:worker   # necesita MONGO_URI, REDIS_URL y S3_* en el entorno
```

## Media (storage privado)

`src/services/media.ts` sube, borra y firma URLs (≤ 15 min) sobre un bucket S3-compatible: MinIO en local. Config en `S3_*` (ver `.env.example`); la URL se firma con `S3_PUBLIC_ENDPOINT`, que es el host que alcanza la app, no el interno.

El test de integración corre contra un MinIO real y se saltea si no está `S3_TEST_ENDPOINT`:

```sh
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d minio minio-init
S3_TEST_ENDPOINT=http://localhost:9000 S3_TEST_ACCESS_KEY_ID=<S3_ACCESS_KEY_ID> \
  S3_TEST_SECRET_ACCESS_KEY=<S3_SECRET_ACCESS_KEY> npm test
```

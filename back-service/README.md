# back-service — Capa 3 · Red segura · :4000

Lógica de negocio, MongoDB, Redis (cola) y worker de IA (`src/worker.ts`). Firma los JWT con RS256 (clave privada).

## Cola de análisis (Redis + BullMQ)

`POST /meals` encola en la cola `meal-analysis` (`src/jobs/meal-analysis.ts`) un job `{ mealId, requestId }` con `jobId = mealId`, 4 intentos y backoff exponencial. Config en `REDIS_URL` (obligatoria).

Los tests de la cola corren contra un Redis real y se saltean si no está `REDIS_TEST_URL`. El override de dev publica el Redis del compose en `127.0.0.1:6379`:

```sh
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d redis
REDIS_TEST_URL=redis://127.0.0.1:6379 npm test
```

## Media (storage privado)

`src/services/media.ts` sube, borra y firma URLs (≤ 15 min) sobre un bucket S3-compatible: MinIO en local. Config en `S3_*` (ver `.env.example`); la URL se firma con `S3_PUBLIC_ENDPOINT`, que es el host que alcanza la app, no el interno.

El test de integración corre contra un MinIO real y se saltea si no está `S3_TEST_ENDPOINT`:

```sh
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d minio minio-init
S3_TEST_ENDPOINT=http://localhost:9000 S3_TEST_ACCESS_KEY_ID=<S3_ACCESS_KEY_ID> \
  S3_TEST_SECRET_ACCESS_KEY=<S3_SECRET_ACCESS_KEY> npm test
```

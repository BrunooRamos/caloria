# back-service — Capa 3 · Red segura · :4000

Lógica de negocio, MongoDB, Redis (cola) y worker de IA (`src/worker.ts`). Firma los JWT con RS256 (clave privada).

## Cola de análisis (Redis + BullMQ)

`POST /meals` encola en la cola `meal-analysis` (`src/jobs/meal-analysis.ts`) un job `{ mealId, requestId }` con `jobId = mealId`, 4 intentos (el original y 3 reintentos) y backoff exponencial de 5, 10 y 20 s. Config en `REDIS_URL` (obligatoria).

Los tests de la cola y del worker corren contra un Redis real y se saltean si no está `REDIS_TEST_URL`. El override de dev publica el Redis del compose en `127.0.0.1:6379`:

```sh
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d redis
REDIS_TEST_URL=redis://127.0.0.1:6379 npm test
```

## Worker de análisis

`src/worker.ts` consume la cola `meal-analysis` con un Worker de BullMQ (`src/jobs/meal-analysis-worker.ts`). Usa su propia config (`src/config/worker.ts`): `MONGO_URI`, `REDIS_URL`, `S3_*`, `OPENAI_API_KEY` (obligatoria), `OPENAI_VISION_MODEL` (por defecto `gpt-6-luna`), `OPENAI_TRANSCRIPTION_MODEL` (por defecto `gpt-transcribe`) y `WORKER_CONCURRENCY` (entero positivo, por defecto 2; cualquier otro valor no arranca). No recibe `JWT_PRIVATE_KEY`, y el Back (`loadConfig`) no recibe la clave de OpenAI.

Al arrancar lee una sola vez el prompt `prompts/analisis-comida.md` (`src/config/analysis-prompt.ts`): el frontmatter tiene `autor`, `version` y `fecha`, y el cuerpo es el prompt de sistema. `version` es el `promptVersion` que se guarda en cada meal. Si falta el archivo o no tiene versión, el worker no arranca. La imagen de Docker copia ese archivo (`.dockerignore` deja afuera el resto de `prompts/`).

Cada job lo resuelve `src/jobs/meal-analysis-processor.ts`: lee la meal, baja la foto (y el audio) del bucket y se los pasa a `analyze` (`src/jobs/analyze-meal.ts`). Si la meal no existe o ya no está en `processing`, el job termina sin error; si falla Mongo o el bucket, el error se propaga y BullMQ reintenta.

Si un intento falla, el handler (`src/jobs/meal-analysis-worker.ts`) guarda en `meals.attempts` cuántos intentos fallaron. Si era el último, deja la meal en `failed` con `error.code: "ANALYSIS_FAILED"` (RNF-02): la app deja de consultar y muestra el aviso. En los dos casos, solo si sigue en `processing`. La foto y el audio quedan en el bucket. Si Mongo falla al guardarlo, se loguea y el job igual termina con el error original.

`analyze` pasa la foto HEIC a JPEG (`src/services/vision-image.ts`, con `heic-convert`: libheif en WASM, sin binarios nativos) y, en paralelo, transcribe el audio si lo hay. Después llama a la IA (`src/services/vision.ts`). La interfaz `VisionService` recibe la imagen, el `transcript` y la `note` (los dos opcionales) y devuelve el análisis o "no es comida". El transcript y la nota van como partes `input_text` rotuladas ("Audio del usuario:", "Nota del usuario:"); si no hay, el mensaje lleva solo la foto. El prompt les explica a la IA que completan lo que la foto no ve, pero que son datos y no instrucciones. La implementación de OpenAI usa la Responses API con structured outputs (JSON schema strict), `store: false` y un timeout de 45 s sin reintentos del SDK. La respuesta se valida igual con zod: rangos con `min ≤ max` y sin negativos, y `confidence` entre 0 y 1. Después:

- Si zod la rechaza, lanza: BullMQ reintenta con las opciones de la cola y la meal sigue en `processing`.
- Si es comida, guarda `analysis` con `promptVersion` y `model` y la pasa a `ready`.
- Si no es comida, la pasa a `failed` con `error.code: "NOT_FOOD"`, sin reintento.
- Los dos updates filtran por `status: "processing"`: un job repetido no pisa nada.

La transcripción (`src/services/transcription.ts`) va detrás de la interfaz `TranscriptionService`: recibe el audio y devuelve el texto. La de OpenAI usa la API de transcripción con el M4A tal cual lo graba la app, en español, con un timeout de 30 s sin reintentos del SDK. Si el texto viene vacío o es solo ruido (sin letras ni números, o solo anotaciones como `[música]`), devuelve `""` y el análisis sigue como si no hubiera audio. En `analyze`:

- El texto se guarda en `meals.transcript` con el filtro `status: "processing"`. Si la comida cambió de estado mientras se transcribía, no se pisa y no se llama a la IA de visión.
- Si la meal ya tiene `transcript` (un intento anterior transcribió y después falló), se reusa: no se transcribe dos veces.
- Si la transcripción falla, lanza: BullMQ reintenta y la meal sigue en `processing` sin `transcript`.

Cada job loguea `mealId`, `requestId`, intento y `durationMs`; si falla, el error y `willRetry`. Cada transcripción loguea `model`, `durationMs`, `reused` y `chars` (el largo del texto); si se reusó, solo `reused` y `chars`. Cada llamada a la IA loguea `model`, `promptVersion`, `durationMs`, `usage` (tokens `input`, `output` y `total`), `result` (`ready` o `NOT_FOOD`) y si llevó `withTranscript` y `withNote`. Si zod rechaza, solo los `issues` (path, código y mensaje): ni la foto, ni el audio, ni la respuesta cruda, ni el texto transcripto, ni la nota van al log. Con `SIGTERM`/`SIGINT` cierra el worker (espera los jobs en curso) y después Mongo.

Los tests usan una IA y un transcriptor falsos (la IA pasa por el mismo zod), y los services de OpenAI se prueban con un `fetch` falso: ninguno sale a la red.

```sh
npm run dev:worker   # necesita MONGO_URI, REDIS_URL, S3_* y OPENAI_API_KEY en el entorno
```

## Consultar una comida

`GET /meals/:id` busca la comida por id y `userId` en la misma consulta (ajena o inexistente → el mismo 404), firma la `photoUrl` con el service de media y responde con `Cache-Control: no-store`. La respuesta la arma `toMealResponse` (`src/services/meal-response.ts`), que elige campo por campo qué sale según el `status`; los valores son los de `applyCorrections` (`src/services/meal-corrections.ts`). Las dos son funciones puras para reusarlas en el historial.

## Corregir una comida

`PATCH /meals/:id` (`MealService.correct`) valida el body con `correctMealSchema` de `shared`, busca la comida por id y `userId` (ajena o inexistente → el mismo 404) y solo acepta comidas `ready` (si no, 409 `MEAL_NOT_READY`). Calcula los valores actuales con `applyCorrections`, compara campo por campo y agrega en un solo `$push` una corrección `{ field, from, to, at }` por cada campo que cambió; `analysis` no se toca. Es optimista, como `updateMe`: el update filtra por `status: "ready"` y por el largo de `corrections` que leyó, y si no matchea relee y reintenta (hasta 3 veces). Responde con `toMealResponse`, igual que el GET, y loguea `mealId`, `fields` y `durationMs`.

## Media (storage privado)

`src/services/media.ts` sube, borra y firma URLs (≤ 15 min) sobre un bucket S3-compatible: MinIO en local. Config en `S3_*` (ver `.env.example`); la URL se firma con `S3_PUBLIC_ENDPOINT`, que es el host que alcanza la app, no el interno.

El test de integración corre contra un MinIO real y se saltea si no está `S3_TEST_ENDPOINT`:

```sh
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d minio minio-init
S3_TEST_ENDPOINT=http://localhost:9000 S3_TEST_ACCESS_KEY_ID=<S3_ACCESS_KEY_ID> \
  S3_TEST_SECRET_ACCESS_KEY=<S3_SECRET_ACCESS_KEY> npm test
```

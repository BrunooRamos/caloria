# back-service — Capa 3 · Red segura · :4000

Lógica de negocio, MongoDB, Redis (cola) y worker de IA (`src/worker.ts`). Firma los JWT con RS256 (clave privada).

## Cola de análisis (Redis + BullMQ)

`POST /meals` encola en la cola `meal-analysis` (`src/jobs/meal-analysis.ts`) un job `{ mealId, requestId }` con `jobId = mealId`, 4 intentos y backoff exponencial. Config en `REDIS_URL` (obligatoria). Antes de subir la media reserva un análisis del cupo free (`src/services/quota.ts`); el límite sale de `FREE_MONTHLY_ANALYSES` (obligatoria, entero ≥ 0; el plan definido es 40). Las rutas solo premium usan `requirePremium` (`src/middleware/plan.ts`).

Los tests de la cola y del worker corren contra un Redis real y se saltean si no está `REDIS_TEST_URL`. El override de dev publica el Redis del compose en `127.0.0.1:6379`:

```sh
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d redis
REDIS_TEST_URL=redis://127.0.0.1:6379 npm test
```

## Worker de análisis

`src/worker.ts` consume la cola `meal-analysis` con un Worker de BullMQ (`src/jobs/meal-analysis-worker.ts`) y la cola `weekly-summary` del Wrapped (ver más abajo). Usa su propia config (`src/config/worker.ts`): `MONGO_URI`, `REDIS_URL`, `S3_*`, `OPENAI_API_KEY` (obligatoria), `OPENAI_VISION_MODEL` (por defecto `gpt-6-luna`), `OPENAI_TRANSCRIPTION_MODEL` (por defecto `gpt-transcribe`), `OPENAI_TEXT_MODEL` (Wrapped, por defecto `gpt-6.1-terra`), `OPENAI_COMMENT_MODEL` (comentario por tono, por defecto `gpt-6-luna`; tiene que aceptar structured outputs y `reasoning: "low"`), `EXPO_ACCESS_TOKEN` (opcional, ver abajo) y `WORKER_CONCURRENCY` (entero positivo, por defecto 2; cualquier otro valor no arranca). No recibe `JWT_PRIVATE_KEY`, y el Back (`loadConfig`) no recibe la clave de OpenAI ni la de Expo.

Al arrancar lee una sola vez los prompts `src/prompts/analisis-comida.md`, `identificar-plato.md`, `roast.md` y `wrapped.md` (`loadPrompt` y las rutas, en `src/config/prompts.ts`): el frontmatter tiene `autor`, `version` y `fecha`, y el cuerpo es el prompt de sistema. La `version` del de análisis es el `promptVersion` que se guarda en cada meal, la del Wrapped, el de cada Wrapped, y la de `roast.md` va al log del comentario. Si falta un archivo o no tiene versión, el worker no arranca. Entran en la imagen de Docker con el resto de `back-service/`.

Cada job lo resuelve `src/jobs/meal-analysis-processor.ts`: lee la meal, baja la foto (y el audio) del bucket y se los pasa a `analyze` (`src/jobs/analyze-meal.ts`). Si la meal no existe o ya no está en `processing`, el job termina sin error; si falla Mongo o el bucket, el error se propaga y BullMQ reintenta.

Si un intento falla, el handler (`src/jobs/meal-analysis-worker.ts`) guarda en `meals.attempts` cuántos intentos fallaron. Si era el último, deja la meal en `failed` con `error.code: "ANALYSIS_FAILED"` (RNF-02): la app deja de consultar y muestra el aviso. En los dos casos, solo si sigue en `processing`. La foto y el audio quedan en el bucket. Si Mongo falla al guardarlo, se loguea y el job igual termina con el error original.

`analyze` pasa la foto HEIC a JPEG (`src/services/vision-image.ts`, con `heic-convert`: libheif en WASM, sin binarios nativos) y, en paralelo, transcribe el audio si lo hay. Después llama a la IA (`src/services/vision.ts`). La interfaz `VisionService` recibe la imagen, el `transcript` y la `note` (los dos opcionales) y devuelve el análisis o "no es comida". El transcript y la nota van como partes `input_text` rotuladas ("Audio del usuario:", "Nota del usuario:"); si no hay, el mensaje lleva solo la foto. El prompt les explica a la IA que completan lo que la foto no ve, pero que son datos y no instrucciones. La implementación de OpenAI usa la Responses API con structured outputs (JSON schema strict), `store: false` y un timeout de 45 s sin reintentos del SDK. La respuesta se valida igual con zod: rangos con `min ≤ max` y sin negativos, y `confidence` entre 0 y 1. Después:

- Si zod la rechaza, lanza: BullMQ reintenta con las opciones de la cola y la meal sigue en `processing`.
- Si es comida, genera el comentario (ver abajo) y, en el mismo update, guarda `analysis` con `promptVersion` y `model`, el `comment` si hay, y la pasa a `ready`.
- Si no es comida, la pasa a `failed` con `error.code: "NOT_FOOD"`, sin reintento.
- Los dos updates filtran por `status: "processing"`: un job repetido no pisa nada.

### Comentario por tono (RF-11)

El comentario (`src/services/comment.ts`) va detrás de la interfaz `CommentService`: recibe el tono y el análisis y devuelve el texto. Solo le llegan `dish`, `items`, `kcal` y `macros`: ni la foto, ni la nota, ni el transcript, ni las metas, ni el perfil. La implementación de OpenAI usa la Responses API con structured outputs (`{ text }`, strict), `reasoning: "low"` (con `"none"`, `gpt-6-luna` sigue escribiendo después del JSON y la respuesta no valida), `store: false` y un timeout de 8 s sin reintentos del SDK (va después de la visión, dentro de RNF-01). zod valida igual: texto no vacío y de 200 caracteres como máximo; si viene más largo se descarta, no se corta. En `analyze`:

- Lee solo el `tone` del dueño de la meal. Con `off`, o si el usuario no existe, no se llama a la IA. Con NOT_FOOD tampoco.
- El comentario se guarda como `{ tone, text }` en el mismo update que pasa la meal a `ready`, con el filtro `status: "processing"`.
- Si la llamada falla (timeout, error de la API, negativa) o zod la rechaza, la meal queda `ready` sin `comment` y no se reintenta: no se vuelve a pagar la visión por un comentario.
- Red de seguridad (`src/services/comment-safety.ts`): si el texto menciona el peso, el cuerpo, la apariencia o la restricción (una lista corta de términos, sin tildes ni mayúsculas), se descarta igual que si hubiera fallado. El control principal es el prompt (`prompts/roast.md`), que prohíbe esos temas en los tres tonos (RNF-10).
- Corregir la meal con `PATCH /meals/:id` no regenera el comentario.

El tono lo elige el usuario con `PATCH /users/me` (`{ "tone": "roast" }`); por defecto es `motivador`.

#### Set de comidas problemáticas

`test/fixtures/comidas-problematicas.ts` tiene análisis que invitan a pasarse (más de 2500 kcal, menos de 80, café solo, postre doble, comida rápida, mucha grasa) y comentarios de ejemplo que el filtro tiene que bloquear o dejar pasar. Los tests lo corren con un comentador falso. Para verlo contra OpenAI de verdad, con los tres tonos, hay un script que no va al CI (gasta llamadas):

```sh
OPENAI_API_KEY=sk-… npm run comments:check   # opcional: OPENAI_COMMENT_MODEL
```

Imprime cada comentario con el tono, el tiempo y el largo, y marca los que el filtro bloquea o zod rechaza (en ese caso sale con código 1). Sin `OPENAI_API_KEY` no hace nada. Igual hay que leerlos a mano: el filtro es solo una red.

La transcripción (`src/services/transcription.ts`) va detrás de la interfaz `TranscriptionService`: recibe el audio y devuelve el texto. La de OpenAI usa la API de transcripción con el M4A tal cual lo graba la app, en español, con un timeout de 30 s sin reintentos del SDK. Si el texto viene vacío o es solo ruido (sin letras ni números, o solo anotaciones como `[música]`), devuelve `""` y el análisis sigue como si no hubiera audio. En `analyze`:

- El texto se guarda en `meals.transcript` con el filtro `status: "processing"`. Si la comida cambió de estado mientras se transcribía, no se pisa y no se llama a la IA de visión.
- Si la meal ya tiene `transcript` (un intento anterior transcribió y después falló), se reusa: no se transcribe dos veces.
- Si la transcripción falla, lanza: BullMQ reintenta y la meal sigue en `processing` sin `transcript`.

### Compounding (RF-07)

Antes de llamar a la IA, `analyze` busca comidas corregidas parecidas del mismo usuario (`src/jobs/similar-meals-lookup.ts`) y se las pasa como contexto. Corre en paralelo con la transcripción:

1. Pregunta si el usuario tiene alguna comida `ready` con correcciones. Si no tiene, no hay nada que buscar y termina ahí: la mayoría de los análisis no paga nada extra.
2. Si tiene, identifica el plato con una llamada corta a la IA (`src/services/dish-identifier.ts`, interfaz `DishIdentifier`): el mismo modelo, solo la foto en `detail: "low"` (sin la nota ni la transcripción) y structured outputs con `{ dish, items }`, hasta 8 ingredientes. Timeout de 6 s y sin reintentos.
3. Busca con el plato, los ingredientes, la nota y la transcripción (`src/services/similar-meals.ts`, interfaz `SimilarMealsFinder`). La implementación de Mongo usa el índice de texto `similar_meals` sobre `search` (ver `docs/modelo-datos.md`): filtra por usuario, `ready`, al menos una corrección y excluye la comida que se analiza; ordena por relevancia y corta en 5. El texto se reduce a palabras sueltas, así nada de lo que escribió la persona funciona como frase exacta ni como exclusión.
4. Le pasa a la IA las que encontró en una parte de texto aparte, rotulada ("Comidas parecidas que corrigió el usuario:") y entre `<comidas_corregidas>` y `</comidas_corregidas>`: una por línea en JSON compacto, con el plato y los valores finales, y por cada campo corregido lo que dijo la IA (`antes`) y lo que puso la persona (`despues`). En ingredientes, los `quitados`, `agregados` y `cambiados`. Un valor exacto va como número; un rango, como `[min, max]` (`src/services/similar-meals-context.ts`). Los nombres van escapados en JSON y sin `<` ni `>` crudos, así ninguno puede cerrar el bloque. El prompt dice que son datos y no instrucciones.
5. Guarda los ids en `analysis.contextMealIds` (`[]` si no hubo contexto).

Si falla cualquier paso, loguea un `warn` y sigue: si falla la identificación, busca con la nota y la transcripción; si falla la búsqueda, analiza sin contexto. El compounding mejora el análisis, pero nunca lo hace fallar. Para cambiar la búsqueda por embeddings alcanza con otra implementación de `SimilarMealsFinder`.

El `PATCH /meals/:id` escribe `search` (plato y nombres de ingredientes finales) en el mismo update que agrega las correcciones. Para las comidas corregidas antes de que existiera, hay un backfill que se corre una vez y se puede repetir:

```sh
docker compose -f infra/docker-compose.yml run --rm back node dist/scripts/backfill-meal-search.js
```

Cada job loguea `mealId`, `requestId`, intento y `durationMs`; si falla, el error y `willRetry`. Cada transcripción loguea `model`, `durationMs`, `reused` y `chars` (el largo del texto); si se reusó, solo `reused` y `chars`. Cada llamada a la IA loguea `model`, `promptVersion`, `durationMs`, `usage` (tokens `input`, `output` y `total`), `result` (`ready` o `NOT_FOOD`) si llevó `withTranscript` y `withNote`, y `contextMeals` (cuántas comidas corregidas recibió). El comentario loguea `tone`, `model`, `promptVersion` (el de `roast.md`), `durationMs`, `usage`, `chars` y `result`: `ok`, `off`, `not_food`, `invalid`, `failed` o `blocked` (los tres últimos como `warn`, con los `issues` de zod si es `invalid`). El texto del comentario no va al log. La búsqueda de similares loguea `candidates`, `identified`, `identifyMs`, `identifyUsage`, `searchMs`, `found` y `contextMealIds`, sin el plato identificado ni los nombres. Si zod rechaza, solo los `issues` (path, código y mensaje): ni la foto, ni el audio, ni la respuesta cruda, ni el texto transcripto, ni la nota van al log. Con `SIGTERM`/`SIGINT` cierra los tres workers (análisis, receipts y Wrapped; esperan los jobs en curso), después las colas de receipts y del Wrapped y al final Mongo.

Los tests usan una IA, un transcriptor y un comentador falsos (la IA y el comentador pasan por el mismo zod), y los services de OpenAI se prueban con un `fetch` falso: ninguno sale a la red.

```sh
npm run dev:worker   # necesita MONGO_URI, REDIS_URL, S3_* y OPENAI_API_KEY en el entorno
```

## Avisos push (RF-13)

`PATCH /users/me` guarda los push tokens de Expo en `users.pushTokens` y las preferencias en `users.notifications` (`src/services/users.ts`). Todo va en un solo update con pipeline, igual de optimista que el perfil: los tokens se suman al final sin repetir (uno que ya estaba pasa al final) y quedan los últimos 10. Después, con un `$pull`, se le sacan esos tokens a cualquier otra cuenta que los tuviera. Un usuario sin `notifications` (creado antes de RF-13) se lee con todo en `true`.

Los avisos los manda el Worker:

- `src/services/push.ts`: la interfaz `PushService` recibe los tokens y el mensaje y devuelve cuántos salieron bien o mal, los tokens inválidos y los tickets para consultar después. La de Expo usa `fetch` directo contra `https://exp.host/--/api/v2/push/send` (un mensaje por token, de a 100 por request) y `…/getReceipts` (de a 1000 ids), con un timeout de 10 s y sin reintentos. Si falla toda la request (red, 4xx, 5xx o `errors` en el body, p. ej. `TOO_MANY_REQUESTS`), lanza `PushRequestError` con los códigos de Expo. Un ticket o receipt con `DeviceNotRegistered` devuelve su token como inválido. `EXPO_ACCESS_TOKEN` es opcional: solo hace falta si el proyecto tiene activada la seguridad de push en EAS, y va como `Authorization: Bearer`.
- `src/services/notifications.ts`: `notify(userId, aviso, log)` lee los tokens y las preferencias; si el tipo está apagado o no hay tokens no manda nada. Si no, manda, borra con `$pull` los tokens inválidos del ticket y encola los receipts. Nunca lanza: si algo falla, lo loguea y devuelve `"failed"`. Los textos son cortos, en español y sin kcal ni el plato (se ven con la pantalla bloqueada). `data` lleva el `type` y el id para abrir la pantalla: `mealId` en análisis listo y `week` en Wrapped listo.
- Análisis listo: `analyze` lo llama solo si el update a `ready` matcheó (un job repetido no avisa dos veces). Con `NOT_FOOD` no se avisa.
- Wrapped listo: el job `summary` llama a `notifyWrappedReady(userId, week)` solo si el upsert lo dejó `ready`. Si ya estaba `ready` (`skipped`), si lo guardó otro job (`exists`), si no hubo comidas o si falló la IA, no se avisa.
- Receipts: `DeviceNotRegistered` puede llegar recién en el receipt. Por eso cada aviso encola en la cola `push-receipts` (`src/jobs/push-receipts.ts`) un job demorado 15 min (lo que recomienda Expo; los receipts duran 24 h) con 3 intentos y backoff exponencial. Lo procesa `src/jobs/push-receipts-worker.ts`, que saca del usuario los tokens inválidos. Un receipt que todavía no está no se reintenta.
- Racha en riesgo: todavía no está. La racha (#31) ya existe, pero el aviso va en otra PR.

Cada aviso loguea `userId`, `type`, `devices` (a cuántos dispositivos), `ok`, `failed`, `removed` (tokens borrados) y `durationMs`, con los ids del job. Si se saltea, loguea `reason` (`disabled` o `noDevices`). Los tokens nunca van al log (y los campos no se llaman "token", porque el logger redacta esas claves). Los tests usan un `PushService` falso; el de Expo se prueba con un `fetch` falso: ninguno sale a la red.

## Wrapped semanal (cron)

La cola `weekly-summary` (`src/jobs/weekly-summary.ts`) tiene dos jobs:

- `fan-out`: lo crea un job scheduler de BullMQ (`upsertJobScheduler`, id `weekly-summary-cron`, patrón `0 6 * * 1`, `tz: "America/Montevideo"`), que el worker registra al arrancar. Con el mismo id, un reinicio actualiza el cron y no lo duplica. Calcula la semana ISO anterior a hoy en Montevideo, busca los usuarios con al menos una comida `ready` en esa semana y encola un `summary` por usuario con `jobId` `<userId>-<week>`: un fan-out repetido no duplica (BullMQ no admite `:` en un `jobId` propio).
- `summary` `{ userId, week }` (`src/jobs/weekly-summary-processor.ts`): si el resumen ya está `ready`, termina sin llamar a la IA. Si no, calcula las métricas (`src/services/weekly-metrics.ts`), pide los insights y hace un upsert a `ready` con un filtro que excluye los `ready`; el E11000 del índice único cuenta como "ya existe". Si el usuario ya no tiene comidas `ready` esa semana, loguea y termina sin error. Si falla OpenAI o zod, lanza y BullMQ reintenta con las mismas opciones que `meal-analysis` (4 intentos, backoff exponencial); al agotarlos, el handler (`src/jobs/weekly-summary-worker.ts`) deja el resumen en `failed`.

Las métricas salen de una agregación sobre `meals` por `userId` y `localDate` que aplica las correcciones con `currentValue` (la misma regla que `applyCorrections` y el dashboard). Se pueden probar sin Redis. El cálculo de cada una está en [docs/modelo-datos.md](../docs/modelo-datos.md#weekly_summaries).

Los insights (`src/services/insights.ts`) van detrás de la interfaz `InsightsService`: recibe la semana agregada y devuelve los insights. La IA recibe solo las métricas y, por día, las kcal, la cantidad de comidas y los nombres de los platos, como JSON en un mensaje rotulado ("Datos de la semana:"): nunca fotos, transcripciones ni notas. Los nombres de platos los puede escribir el usuario (PATCH), así que el prompt los trata como datos y no como instrucciones. La implementación de OpenAI usa la Responses API con structured outputs (`minItems`/`maxItems`), `store: false` y un timeout de 60 s sin reintentos del SDK. La respuesta se valida igual con zod: de 3 a 5 strings no vacíos de hasta 140 caracteres (`WRAPPED_INSIGHT_MAX_CHARS`, en `shared`).

El fan-out loguea `week`, `users` (cuántos encoló) y `durationMs`. Cada `summary` loguea `userId`, `week`, intento, el `outcome` (`generated`, `skipped` si ya estaba ready, `no-meals` o `exists`) y `durationMs`; y la llamada a la IA, `model`, `promptVersion`, `usage` (tokens), `insights` (cuántos) y `durationMs`. Ni el texto de los insights ni los platos ni `topDish` van al log.

Para dispararlo a mano en local, sin esperar al lunes (lo procesa el worker que esté corriendo; solo necesita `REDIS_URL`):

```sh
npm run wrapped                     # la semana anterior a hoy
npm run wrapped -- --week 2026-W43  # una semana puntual
```

Un `summary` que terminó en `failed` queda en la cola 7 días con el mismo `jobId`: un fan-out manual de esa semana no lo vuelve a encolar hasta que se borre.

## Wrapped de una semana

`GET /summaries/weekly/:week` (`src/services/summaries.ts`) valida `week` con `weeklySummaryParamsSchema` de `shared` (formato `YYYY-Www` y una semana que exista en ese año), busca el resumen por `userId` del token, `week` y `status: "ready"` en la misma consulta (ajeno, inexistente, `pending` o `failed` → el mismo 404) y responde `{ week, from, to, metrics, insights, generatedAt }` con `Cache-Control: no-store`. `from` y `to` salen de la semana; no salen `_id`, `userId`, `status` ni `promptVersion`.

## Consultar una comida

`GET /meals/:id` busca la comida por id y `userId` en la misma consulta (ajena o inexistente → el mismo 404), firma la `photoUrl` con el service de media y responde con `Cache-Control: no-store`. La respuesta la arma `toMealResponse` (`src/services/meal-response.ts`), que elige campo por campo qué sale según el `status`; los valores son los de `applyCorrections` (`src/services/meal-corrections.ts`). Las dos son funciones puras para reusarlas en el historial.

## Corregir una comida

`PATCH /meals/:id` (`MealService.correct`) valida el body con `correctMealSchema` de `shared`, busca la comida por id y `userId` (ajena o inexistente → el mismo 404) y solo acepta comidas `ready` (si no, 409 `MEAL_NOT_READY`). Calcula los valores actuales con `applyCorrections`, compara campo por campo y agrega en un solo `$push` una corrección `{ field, from, to, at }` por cada campo que cambió; `analysis` no se toca. En el mismo update guarda en `search` el plato y los nombres de los ingredientes finales, para la búsqueda de similares (RF-07). Es optimista, como `updateMe`: el update filtra por `status: "ready"` y por el largo de `corrections` que leyó, y si no matchea relee y reintenta (hasta 3 veces). Responde con `toMealResponse`, igual que el GET, y loguea `mealId`, `fields` y `durationMs`.

## Media (storage privado)

`src/services/media.ts` sube, borra y firma URLs (≤ 15 min) sobre un bucket S3-compatible: MinIO en local. Config en `S3_*` (ver `.env.example`); la URL se firma con `S3_PUBLIC_ENDPOINT`, que es el host que alcanza la app, no el interno.

El test de integración corre contra un MinIO real y se saltea si no está `S3_TEST_ENDPOINT`:

```sh
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d minio minio-init
S3_TEST_ENDPOINT=http://localhost:9000 S3_TEST_ACCESS_KEY_ID=<S3_ACCESS_KEY_ID> \
  S3_TEST_SECRET_ACCESS_KEY=<S3_SECRET_ACCESS_KEY> npm test
```

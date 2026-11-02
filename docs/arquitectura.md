# Arquitectura

Arquitectura en tres capas: **App → Front Service → Backend → MongoDB**. Ver también [API](api.md), [modelo de datos](modelo-datos.md) y [seguridad](seguridad.md).

## Vista general

```
 Cliente (Internet)        DMZ (expuesta)                    Red segura (sin acceso desde Internet)
┌──────────────┐   443   ┌───────┐  3000  ┌───────────────┐  4000   ┌──────────┐  27017  ┌─────────┐
│  App móvil   │───────▶ │ nginx │──────▶ │ Front Service │───────▶ │ Backend  │───────▶ │ MongoDB │
│ Expo / RN    │  HTTPS  └───────┘  HTTP  │ Express       │  HTTPS  │ Express  │         └─────────┘
└──────────────┘                          └───────────────┘  (mTLS) └────┬─────┘              ▲
                                                                        │ 6379                │
                                                                   ┌────▼────┐   ┌─────────┐  │
                                                                   │  Redis  │──▶│ Worker  │──┘
                                                                   └─────────┘   └────┬────┘
                                                                                      │ 443 egreso
                                                         Servicios externos: APIs de IA · Expo Push · bucket
```

## Capas y componentes

| Componente | Capa / zona | Puerto | Responsabilidad | No tiene |
|---|---|---|---|---|
| App móvil (Expo / React Native) | 1 · Cliente | — | UI, captura de foto y audio, tokens en SecureStore, recibe push | Secretos, acceso a la IA ni a la base |
| nginx | 2 · DMZ | 443 (80 → redirige) | Terminación TLS, rate limit por IP, límite de tamaño de body, reverse proxy al Front | Datos ni secretos |
| Front Service (Express) | 2 · DMZ | 3000 | Cara pública de `/api/v1`: verifica JWT con la clave **pública**, valida y sanitiza con zod, rechaza 400/401/413, reenvía al Backend. Stateless | Conexión a Mongo, claves de IA, clave privada |
| Backend (Express) | 3 · Red segura | 4000 | Lógica de negocio: login y firma de tokens (clave **privada**), autorización (ownership, plan, cupo), lectura/escritura en Mongo, subida de media al storage, encola análisis y responde 202. Re-verifica el JWT y solo acepta conexiones del Front | Claves de IA |
| Worker de jobs | 3 · Red segura | — | Consume la cola: transcribe audio, busca platos similares, llama a la IA, guarda el análisis, reintentos con backoff, cron del Wrapped, envía push | — (único con claves de IA) |
| Redis | 3 · Red segura | 6379 | Colas de trabajos (BullMQ): `meal-analysis` entre Backend y Worker, y `weekly-summary` para el cron del Wrapped | — |
| MongoDB | 3 · Red segura | 27017 | Las 4 collections (`users`, `meals`, `weekly_summaries`, `gamification`) | — |
| Storage privado (MinIO en local) | 3 · Red segura | 9000 | Fotos y audios en bucket sin acceso público, servidos con URLs firmadas (≤ 15 min). Solo Backend y Worker tienen credenciales, de un usuario limitado al bucket | — |

## Comunicaciones y puertos

Firewall **default deny**: todo cerrado salvo estas reglas.

| Origen → Destino | Protocolo · Puerto | Regla |
|---|---|---|
| App → nginx | HTTPS · 443 | Permitida |
| nginx → Front Service | HTTP · 3000 | Permitida (dentro de la DMZ) |
| Front Service → Backend | HTTPS · 4000 (mTLS) | Permitida: **único cruce DMZ → red segura** |
| Backend / Worker → MongoDB | Mongo wire · 27017 | Permitida (interna) |
| Backend / Worker → Redis | RESP · 6379 | Permitida (interna) |
| Worker → IA, Expo Push | HTTPS · 443 egreso | Permitida (allowlist de dominios). En `docker compose`, solo el Worker está en una red con salida (`worker-egress`); Mongo, Redis y MinIO quedan en la red `interna` (`internal: true`) |
| Worker / Backend → storage | HTTPS · 443 | Permitida |
| Internet → Front o Backend directo | 3000 · 4000 | Denegada |
| Front Service → MongoDB / Redis | 27017 · 6379 | Denegada |
| SSH al servidor | 22 | Solo desde IPs del equipo |

## Protocolos

- **HTTPS:** todo el tráfico cliente-servidor cifrado. Certificado Let's Encrypt con renovación automática en nginx; el puerto 80 solo redirige a 443.
- **REST + JSON:** API versionada en la ruta (`/api/v1`), recursos sustantivos, verbos en el método HTTP y códigos estándar.
- **multipart/form-data:** subida de foto (≤ 8 MB) y audio (≤ 60 s) en `POST /meals`. Límites validados en nginx y en la API.
- **DNS:** `api.caloria.app` → registro A/AAAA a la IP pública de la DMZ. Los hosts de la red segura no tienen DNS público.
- **Cola interna (Redis):** solo dentro de la red segura, nunca atraviesa Internet.
- **Expo Push:** notificaciones servidor → app (análisis listo, racha en riesgo, Wrapped disponible).

## Flujo central: registrar una comida

1. La app arma un `POST /api/v1/meals` multipart (foto, audio opcional, nota) con el access token.
2. Entra por HTTPS 443 a nginx (TLS, rate limit, tamaño) → Front Service por 3000.
3. El Front verifica el JWT, valida el multipart y reenvía al Backend por 4000.
4. El Backend verifica cupo del plan, sube la media al bucket privado, crea el documento en `meals` con `status: "processing"`, encola el job y responde **202 Accepted** con el `mealId`.
5. El Worker toma el job (hasta `WORKER_CONCURRENCY` en paralelo), lee la comida de Mongo y baja la foto y el audio del bucket. Si la comida ya no existe o no está en `processing`, descarta el job; si falla Mongo o el bucket, BullMQ reintenta con backoff. Si hay audio, lo transcribe (OpenAI speech-to-text, `services/transcription.ts`, en español) en paralelo con la conversión de la foto, y guarda el texto en `meals.transcript` solo si la comida sigue en `processing`; si un intento anterior ya lo guardó, lo reusa sin volver a transcribir. Una transcripción vacía o de puro ruido cuenta como si no hubiera audio; si la transcripción falla, BullMQ reintenta. En paralelo también busca hasta 5 comidas corregidas parecidas del usuario (RF-07): si tiene alguna, identifica el plato con una llamada corta a la IA (foto en baja resolución) y busca con eso, la nota y la transcripción en un índice de texto de Mongo; si algo falla, sigue sin contexto. Después llama a la IA de visión (OpenAI, `services/vision.ts`) con la foto + la transcripción y la nota (si hay, como partes de texto rotuladas) + las comidas corregidas (plato, valores finales y qué se corrigió). Las fotos HEIC se pasan a JPEG antes, porque la API no las acepta. El prompt de sistema es `back-service/src/prompts/analisis-comida.md`, que el Worker lee una vez al arrancar: el audio y la nota completan lo que la foto no ve, pero son datos y no instrucciones.
6. Valida la respuesta con zod (rangos con `min ≤ max` y sin negativos, `confidence` entre 0 y 1); si no cumple, lanza y BullMQ reintenta. Si es comida, guarda en `meals` el análisis en rangos, la confianza, `promptVersion`, `model`, los ids de las comidas que fueron contexto (`contextMealIds`) y el comentario (`status: "ready"`), actualiza la racha y dispara el push "análisis listo". Si no es comida, la deja `failed` con `error.code: "NOT_FOOD"`, sin reintento. En los dos casos, solo si sigue en `processing`.
7. La app consulta `GET /meals/:id` hasta que deja de estar en `processing` y muestra el rango. El Backend busca la comida por id y dueño, aplica las correcciones y firma la `photoUrl` en cada request (15 min, sin caché). Si el usuario corrige, un `PATCH /meals/:id` agrega a `corrections` los campos que cambiaron (sin tocar `analysis`), guarda en `search` el plato y los ingredientes finales para la búsqueda de similares y responde la comida con los valores corregidos, que son los que suma el dashboard y los que alimentan el próximo análisis.

## Wrapped semanal (cron)

1. Al arrancar, el Worker lee `back-service/src/prompts/wrapped.md` (sin archivo o sin versión no arranca) y registra en la cola `weekly-summary` un job scheduler de BullMQ (`upsertJobScheduler`, id `weekly-summary-cron`): patrón `0 6 * * 1` en `America/Montevideo`, los lunes a las 06:00 (en v1, UTC-3 para todos). Con el mismo id, reiniciar el Worker lo actualiza y no lo duplica.
2. El job del cron (`fan-out`) solo reparte: calcula la semana ISO anterior (el lunes 2027-01-04 da `2026-W53`), busca los usuarios con al menos una comida `ready` con `localDate` en esa semana y encola un job `summary` `{ userId, week }` por usuario con `jobId` `<userId>-<week>`. Un fan-out repetido no duplica nada (BullMQ ignora un `jobId` que ya existe, y no admite `:` en un id propio).
3. Cada job `summary`: si la semana ya está `ready`, termina sin llamar a la IA. Si no, calcula las métricas con una agregación sobre `meals` (las mismas correcciones que el dashboard) y le pide de 3 a 5 insights a la IA de texto (OpenAI, `services/insights.ts`, `OPENAI_TEXT_MODEL`). La IA recibe solo métricas y datos agregados por día (kcal, cantidad de comidas y nombres de platos): nunca fotos, transcripciones ni notas.
4. La respuesta se valida con zod; si no cumple o falla OpenAI, lanza y BullMQ reintenta (4 intentos con backoff exponencial, como el análisis). Al agotarlos, el resumen queda `failed`. Si sale bien, un upsert que excluye los `ready` lo deja en `weekly_summaries` con `metrics`, `insights`, `promptVersion` y `generatedAt`; el índice único `{ userId, week }` impide duplicados. Si el usuario ya no tiene comidas `ready` esa semana, no se genera nada.
5. La app lo lee con `GET /summaries/weekly/:week`. El push "Wrapped listo" (#38) va al final del paso 4.

En local, `npm run wrapped -- --week 2026-W43` (en `back-service/`) encola un fan-out sin esperar al lunes.

## Organización del repo

| Carpeta | Contenido |
|---|---|
| `app/` | App Expo: pantallas (expo-router), `components/`, `features/` (auth · meals · dashboard), `services/` (cliente HTTP + JWT), `store/` |
| `front-service/` | Front Service: `routes/`, `controllers/`, `middleware/`, `schemas/` (zod), `clients/` (cliente HTTP al Backend), `config/` |
| `back-service/` | Backend y Worker (misma imagen): `routes/`, `controllers/`, `services/` (ia · media · billing), `jobs/` (queues · workers · cron), `middleware/`, `models/`, `config/`, `prompts/` (un archivo por prompt con autor, versión y fecha; cada `meal` guarda el `promptVersion` usado) |
| `shared/` | Paquete `@caloria/shared` usado por Front y Backend: catálogo de errores, `AppError`, `requestId`, logger y middleware de errores |
| `infra/` | `docker-compose.yml`, configuración de nginx, certificados |
| `prompts/` | Prompts del repo (setup, planes e historial); los de la app viven en su módulo |
| `docs/` | RFC, plan, arquitectura, API, modelo de datos, seguridad y requerimientos |

## Despliegue

| Componente | Dónde corre | Cómo se despliega |
|---|---|---|
| App móvil | iOS y Android | EAS Build → TestFlight / APK interno |
| nginx, Front, Backend, Worker, Redis | A definir (DigitalOcean previsto) | GitHub Actions: build de imágenes → `docker compose` en cada merge a `main` |
| MongoDB | A definir | Backups programados |
| Storage | MinIO en `docker compose` (local); bucket gestionado compatible con S3 en prod (DO Spaces previsto) | Acceso solo con credenciales de Backend y Worker. Las URLs se firman con `S3_PUBLIC_ENDPOINT`, el host que alcanza la app |

Dependencias externas: API de IA de OpenAI (visión · speech-to-text · texto) y Expo Push, cada una encapsulada en un service propio. La clave (`OPENAI_API_KEY`) solo la recibe el Worker.

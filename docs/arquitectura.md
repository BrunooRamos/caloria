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
| Redis | 3 · Red segura | 6379 | Cola de trabajos entre Backend y Worker | — |
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
| Worker / Backend → IA, Expo Push, storage | HTTPS · 443 egreso | Permitida (allowlist de dominios) |
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
5. El Worker toma el job (hasta `WORKER_CONCURRENCY` en paralelo), lee la comida de Mongo y baja la foto y el audio del bucket. Si la comida ya no existe o no está en `processing`, descarta el job; si falla Mongo o el bucket, BullMQ reintenta con backoff. Después transcribe el audio, busca platos similares del usuario (con sus correcciones) y llama a la IA de visión con foto + transcripción + historial.
6. Guarda en `meals` el análisis en rangos, la confianza y el comentario (`status: "ready"`), actualiza la racha y dispara el push "análisis listo".
7. La app hace `GET /meals/:id` y muestra el rango. Si el usuario corrige, un `PATCH /meals/:id` persiste la corrección, que alimenta el próximo análisis.

## Organización del repo

| Carpeta | Contenido |
|---|---|
| `app/` | App Expo: pantallas (expo-router), `components/`, `features/` (auth · meals · dashboard), `services/` (cliente HTTP + JWT), `store/` |
| `front-service/` | Front Service: `routes/`, `controllers/`, `middleware/`, `schemas/` (zod), `clients/` (cliente HTTP al Backend), `config/` |
| `back-service/` | Backend y Worker (misma imagen): `routes/`, `controllers/`, `services/` (ia · media · billing), `jobs/` (queues · workers · cron), `middleware/`, `models/`, `config/` |
| `shared/` | Paquete `@caloria/shared` usado por Front y Backend: catálogo de errores, `AppError`, `requestId`, logger y middleware de errores |
| `infra/` | `docker-compose.yml`, configuración de nginx, certificados |
| `prompts/` | Un archivo por prompt con autor, versión y fecha. Cada `meal` guarda el `promptVersion` usado |
| `docs/` | RFC, plan, arquitectura, API, modelo de datos, seguridad y requerimientos |

## Despliegue

| Componente | Dónde corre | Cómo se despliega |
|---|---|---|
| App móvil | iOS y Android | EAS Build → TestFlight / APK interno |
| nginx, Front, Backend, Worker, Redis | A definir (DigitalOcean previsto) | GitHub Actions: build de imágenes → `docker compose` en cada merge a `main` |
| MongoDB | A definir | Backups programados |
| Storage | MinIO en `docker compose` (local); bucket gestionado compatible con S3 en prod (DO Spaces previsto) | Acceso solo con credenciales de Backend y Worker. Las URLs se firman con `S3_PUBLIC_ENDPOINT`, el host que alcanza la app |

Dependencias externas: API de IA (visión · speech-to-text · texto) y Expo Push, cada una encapsulada en un service propio.

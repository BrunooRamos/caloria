# Contrato de la API

REST + JSON, versionada en `/api/v1`. El Front Service expone los mismos endpoints que el Backend: valida y reenvía. Todas las rutas, salvo las marcadas como públicas, requieren `Authorization: Bearer <accessToken>`.

## Autenticación y perfil

| Método | Ruta | Auth | Descripción | Éxito | RF |
|---|---|---|---|---|---|
| POST | `/auth/register` | Pública | Alta con email, password y perfil inicial | 201 | RF-01, RF-02 |
| POST | `/auth/login` | Pública | Devuelve `accessToken` (15 min) + `refreshToken` (30 d) | 200 | RF-01 |
| POST | `/auth/refresh` | Refresh token | Rota el par de tokens | 200 | RF-01 |
| POST | `/auth/logout` | JWT | Revoca la familia de refresh tokens | 204 | RF-01 |
| GET | `/users/me` | JWT | Perfil, metas diarias y plan vigente | 200 | RF-02 |
| PATCH | `/users/me` | JWT | Edita perfil o preferencias (tono, push tokens); recalcula metas | 200 | RF-02, RF-11, RF-13 |
| DELETE | `/users/me` | JWT | Borrado total de cuenta, media y documentos | 204 | RNF-04 |

## Comidas, dashboard y plan

| Método | Ruta | Auth | Descripción | Éxito | RF |
|---|---|---|---|---|---|
| POST | `/meals` | JWT | Multipart: `photo`, `audio?`, `note?`. Encola el análisis | 202 | RF-03, RF-04 |
| GET | `/meals?date=&cursor=` | JWT | Historial paginado del día | 200 | RF-08 |
| GET | `/meals/:id` | JWT | Análisis en rangos, confianza y comentario | 200 | RF-05, RF-11 |
| PATCH | `/meals/:id` | JWT | Corrección del usuario; persiste para compounding | 200 | RF-06, RF-07 |
| DELETE | `/meals/:id` | JWT | Elimina la comida y su media | 204 | RF-08 |
| GET | `/dashboard/daily?date=` | JWT | Consumido vs. meta y racha | 200 | RF-09, RF-10 |
| GET | `/summaries/weekly/:week` | JWT | Wrapped de la semana (`2026-W38`) | 200 | RF-12 |
| GET | `/billing/plan` | JWT | Plan vigente y análisis restantes del mes | 200 | RF-14, RF-16 |
| POST | `/billing/subscribe` | JWT | Alta premium (pago sandbox) | 200 | RF-16 |

## Ejemplos

### Registro

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "cami@example.com",
  "password": "********",
  "profile": { "sex": "female", "birthDate": "2002-04-10", "heightCm": 165, "weightKg": 60,
               "activity": "moderate", "goal": "maintain", "timezone": "America/Montevideo" }
}
```
```http
201 Created
{ "accessToken": "…", "refreshToken": "…", "user": { "id": "66f1…", "email": "cami@example.com" } }
```

- El email se normaliza (`trim` + minúsculas) antes de validar y guardar; si ya existe → 409 `EMAIL_TAKEN`.
- La contraseña tiene entre 8 caracteres y 72 bytes (límite de bcrypt).
- El perfil sigue los rangos de RF-02 (edad 16–100, altura 100–250 cm, peso 30–300 kg) y `timezone` es una zona IANA.
- `accessToken`: JWT RS256 de 15 min con `{ sub, plan, iat, exp }`. `refreshToken`: opaco, de 30 días; en la base se guarda solo su hash SHA-256.

### Login

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "cami@example.com", "password": "********" }
```

Devuelve 200 con la misma forma que el registro. Con email inexistente o contraseña incorrecta responde 401 `UNAUTHORIZED` con el mismo mensaje y en un tiempo similar, para no revelar si la cuenta existe.

### Refresh

```http
POST /api/v1/auth/refresh
Content-Type: application/json

{ "refreshToken": "…" }
```

Es pública (no lleva `Authorization`): se usa cuando el access ya venció. Devuelve 200 con la misma forma que el registro y un par nuevo de la **misma familia**; el refresh usado queda marcado como rotado y deja de servir.

- El access nuevo lleva el `plan` vigente en la base en ese momento, no el del access anterior.
- Inexistente, vencido o revocado → 401 `UNAUTHORIZED`.
- Ya rotado (reuso) → se revoca **toda la familia**, se loguea un warning con `userId` y familia, y responde el mismo 401 `UNAUTHORIZED`: la respuesta no deja ver que se detectó un reuso.
- La rotación es atómica: de dos refresh simultáneos con el mismo token, uno rota y el otro cuenta como reuso.

### Logout

```http
POST /api/v1/auth/logout
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "refreshToken": "…" }
```

Revoca la familia de ese refresh si pertenece al usuario del access y responde 204 sin cuerpo. Es idempotente: si el refresh no existe, es de otro usuario o la familia ya estaba revocada, también responde 204 (sin revocar nada ajeno). Las otras familias del usuario (otros dispositivos) siguen activas.

### Registrar una comida (endpoint central)

```http
POST /api/v1/meals
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data

photo: plato.jpg      // ≤ 8 MB, image/jpeg | image/png | image/heic
audio: nota.m4a       // ≤ 60 s, opcional
note:  "milanesa con puré"
```
```http
202 Accepted
{ "mealId": "66f1a…", "status": "processing" }
```

### Consultar el análisis

```http
GET /api/v1/meals/66f1a…
```
```json
{
  "id": "66f1a…",
  "status": "ready",
  "capturedAt": "2026-10-06T13:05:00Z",
  "photoUrl": "https://…firmada…",
  "dish": "Milanesa con puré",
  "items": [{ "name": "Milanesa", "grams": { "min": 150, "max": 190 }, "kcal": { "min": 380, "max": 470 } }],
  "kcal": { "min": 620, "max": 780 },
  "macros": {
    "protein": { "min": 38, "max": 46 },
    "carbs":   { "min": 50, "max": 65 },
    "fat":     { "min": 28, "max": 38 }
  },
  "confidence": 0.72,
  "comment": { "tone": "roast", "text": "…" }
}
```

Mientras `status` es `processing`, la respuesta trae solo `id`, `status`, `capturedAt` y `photoUrl`. Si es `failed`, se incluye `error.code`.

### Corregir una comida

```http
PATCH /api/v1/meals/66f1a…
Content-Type: application/json

{ "dish": "Milanesa napolitana con puré", "kcal": { "min": 800, "max": 900 } }
```

Cada campo cambiado se registra en `corrections` con su valor anterior y nuevo (ver [modelo de datos](modelo-datos.md)).

## Códigos HTTP

| Código | Cuándo |
|---|---|
| 200 / 201 | Lectura OK / recurso creado (register) |
| 202 | Análisis aceptado y encolado |
| 204 | Borrado o logout, sin cuerpo |
| 400 | Entrada inválida (falla la validación zod) |
| 401 | Sin token, vencido o inválido |
| 402 | Cupo del plan free agotado (`MEAL_QUOTA_EXCEEDED`) o función premium |
| 404 | Recurso inexistente **o de otro usuario** (no se distingue, para no filtrar existencia) |
| 409 | Email ya registrado |
| 413 | Foto o audio superan el límite |
| 429 | Rate limit, con header `Retry-After` |
| 500 / 503 | Error interno / proveedor de IA caído |

## Sobre de error único

Toda la API responde los errores con la misma forma. La app mapea `code` → mensaje al usuario.

```json
{ "error": { "code": "MEAL_QUOTA_EXCEEDED", "message": "Cupo mensual agotado", "requestId": "a81f…" } }
```

- `requestId` se genera en el Front, se propaga al Backend (header `X-Request-Id`) y aparece en los logs de ambos.
  - El Front **siempre** genera un UUID nuevo e ignora el `X-Request-Id` que mande el cliente. Lo devuelve en el header `X-Request-Id` de toda respuesta.
  - El Backend usa el `X-Request-Id` recibido; si falta o no es un UUID, genera uno y loguea un warning.
- Los errores nunca exponen stack traces ni detalles internos: un error no previsto responde `500 INTERNAL_ERROR` con un mensaje genérico. El detalle (con stack) queda solo en el log.
- Los errores del Backend con sobre válido llegan al cliente sin modificar. Si el Backend no está alcanzable, el Front responde `503 SERVICE_UNAVAILABLE`; si responde algo que no es un sobre válido, `500 INTERNAL_ERROR`.
- Si la IA falla, el job reintenta con backoff y la comida queda en `processing`: nunca se pierde la media.

El catálogo, `AppError` y el middleware de errores viven en `shared/` (paquete `@caloria/shared`) y los usan ambos servicios. El status se deriva del `code`: en el código se lanza `throw new AppError("MEAL_QUOTA_EXCEEDED")`, nunca se arma la respuesta a mano.

### Códigos de error

| `code` | HTTP |
|---|---|
| `VALIDATION_ERROR` | 400 |
| `UNAUTHORIZED`, `TOKEN_EXPIRED` | 401 |
| `MEAL_QUOTA_EXCEEDED`, `PREMIUM_REQUIRED` | 402 |
| `NOT_FOUND` | 404 |
| `EMAIL_TAKEN` | 409 |
| `PAYLOAD_TOO_LARGE` | 413 |
| `RATE_LIMITED` | 429 |
| `INTERNAL_ERROR` | 500 |
| `AI_UNAVAILABLE` | 503 |
| `SERVICE_UNAVAILABLE` | 503 (el Front no alcanza al Backend) |

El middleware traduce además estos errores de librerías:

| Origen | `code` |
|---|---|
| `ZodError` | `VALIDATION_ERROR` (400) |
| JSON malformado | `VALIDATION_ERROR` (400) |
| Body por encima del límite, o límite de multer | `PAYLOAD_TOO_LARGE` (413) |
| multer con un campo de archivo inesperado (`LIMIT_UNEXPECTED_FILE`) | `VALIDATION_ERROR` (400) |
| Ruta inexistente | `NOT_FOUND` (404) |
| Cualquier otro | `INTERNAL_ERROR` (500) |

### Logs

Una línea JSON por evento, con `requestId`, `service`, `level` y `msg`. Cada request deja una línea con método, ruta (sin query string), status y duración. Los 4xx se loguean sin stack y los 5xx con stack. Nunca se loguean bodies, el header `Authorization`, passwords, tokens ni emails; el logger además redacta esas claves y patrones si se cuelan.

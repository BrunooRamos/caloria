# Contrato de la API

REST + JSON, versionada en `/api/v1`. El Front Service expone los mismos endpoints que el Backend: valida y reenvía. Todas las rutas, salvo las marcadas como públicas, requieren `Authorization: Bearer <accessToken>`.

## Autenticación y perfil

| Método | Ruta | Auth | Descripción | Éxito | RF |
|---|---|---|---|---|---|
| POST | `/auth/register` | Pública | Alta con email, password y perfil inicial | 201 | RF-01, RF-02 |
| POST | `/auth/login` | Pública | Devuelve `accessToken` (15 min) + `refreshToken` (30 d) | 200 | RF-01 |
| POST | `/auth/refresh` | Refresh token | Rota el par de tokens | 200 | RF-01 |
| POST | `/auth/logout` | JWT | Revoca la familia del `refreshToken` del body y saca el `pushToken`, si viene | 204 | RF-01, RF-13 |
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
| GET | `/dashboard/daily?date=` | JWT | Consumido vs. meta del día (la racha llega con RF-10) | 200 | RF-09, RF-10 |
| GET | `/summaries/weekly/:week` | JWT | Wrapped de la semana ISO (`2026-W43`): métricas e insights | 200 | RF-12 |
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
- Un campo desconocido, arriba o dentro de `profile` (por ejemplo `plan`), → 400 `VALIDATION_ERROR`. Lo mismo en login.
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

{ "refreshToken": "…", "pushToken": "ExponentPushToken[xxxx]" }
```

Revoca la familia de ese refresh si pertenece al usuario del access y responde 204 sin cuerpo. Es idempotente: si el refresh no existe, es de otro usuario o la familia ya estaba revocada, también responde 204 (sin revocar nada ajeno). Las otras familias del usuario (otros dispositivos) siguen activas.

- `pushToken` (opcional, RF-13): el token de Expo de este dispositivo. Se saca de la cuenta para que el teléfono deje de recibir sus avisos, aunque la sesión ya estuviera revocada. Solo toca la cuenta del access: si el token es de otra cuenta, no se modifica. Mal formado → 400 `VALIDATION_ERROR` y no se revoca nada.

### Validación en el Front

- Toda ruta valida con zod body, params y query, en modo estricto: un campo desconocido en cualquiera de los tres → 400 `VALIDATION_ERROR`, sin llegar al Backend.
- Sanitización NoSQL: una clave con `$` o `.`, a cualquier profundidad, → 400 `VALIDATION_ERROR`. Se rechaza, no se borra. Los valores no se miran (un email lleva `.`).
- Body JSON de hasta 100 KB; más grande → 413 `PAYLOAD_TOO_LARGE`.
- Las rutas con JWT lo verifican con la clave pública, solo RS256, antes de validar el body: sin token o inválido (otra firma, otro algoritmo, sin `exp`) → 401 `UNAUTHORIZED`; vencido y con firma válida → 401 `TOKEN_EXPIRED`.
- Al Backend se reenvía solo lo validado, con el mismo método, ruta y query, más el mismo `Authorization` en las rutas con JWT. En las públicas no se reenvía el `Authorization` del cliente.
- La respuesta del Backend vuelve con el mismo status y el mismo body. De sus headers pasan solo `Content-Type`, `Retry-After` y `Cache-Control`; el resto (`Set-Cookie`, `Location`, …) no sale de la red segura. Un redirect del Backend no se sigue.

### Perfil y metas

```http
GET /api/v1/users/me
Authorization: Bearer <accessToken>
```
```json
{
  "id": "66f1…",
  "email": "cami@example.com",
  "profile": { "sex": "female", "birthDate": "2002-04-10", "heightCm": 165, "weightKg": 60,
               "activity": "moderate", "goal": "maintain", "timezone": "America/Montevideo" },
  "targets": { "kcal": 2093, "proteinG": 108, "carbsG": 285, "fatG": 58 },
  "tone": "motivador",
  "plan": { "tier": "free", "since": "2026-10-14T19:00:00.000Z" },
  "notifications": { "analysisReady": true, "streakRisk": true, "wrappedReady": true }
}
```

`notifications` son las preferencias de avisos push (RF-13); un usuario que nunca las cambió tiene todo en `true`. Los push tokens nunca salen en la respuesta.

```http
PATCH /api/v1/users/me
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "profile": { "weightKg": 58, "goal": "lose" }, "pushTokens": ["ExponentPushToken[xxxx]"],
  "notifications": { "streakRisk": false } }
```

Devuelve 200 con la misma forma que `GET`, con lo que quedó guardado.

- El body lleva al menos uno de `profile`, `tone`, `pushTokens` y `notifications`.
- En `profile` van solo los campos que cambian, con los mismos rangos que el registro. Fuera de rango, sin ningún campo o con un campo desconocido → 400 `VALIDATION_ERROR`.
- `tone`: `motivador` (el default de una cuenta nueva), `neutro`, `roast` u `off` (RF-11). Con `off` los análisis no traen `comment`. Otro valor → 400 `VALIDATION_ERROR` y no se guarda nada, aunque venga un `profile` válido.
- `tone` solo cambia el tono: no toca el perfil ni recalcula las metas. Si viene con otros campos, va en el mismo update.
- El tono vale para las comidas que se analicen después: no se regeneran los comentarios de antes.
- `pushTokens` (RF-13): hasta 10 tokens de Expo sin repetir, `ExponentPushToken[…]` o `ExpoPushToken[…]`. **Se suman** a los que ya tiene el usuario, no los reemplazan: cada dispositivo manda solo el suyo. Un token que ya estaba pasa a ser el más nuevo, y quedan como mucho 10 (se descartan los más viejos). Si el token estaba en otra cuenta (el mismo teléfono con otro usuario), se le saca a esa cuenta. Los tokens que Expo marca como inválidos (`DeviceNotRegistered`) se borran solos.
- `notifications` (RF-13): parcial, con solo los tipos que cambian (`analysisReady`, `streakRisk`, `wrappedReady`), cada uno un booleano. Vacío, con un tipo desconocido o un valor que no es booleano → 400 `VALIDATION_ERROR`.
- Todo el PATCH se aplica en un solo update: o se guarda todo o nada.
- Con `profile`, las metas se recalculan con la fórmula de [modelo-datos.md](modelo-datos.md#cálculo-de-metas-rf-02). Si dos PATCH llegan a la vez (por ejemplo, uno de perfil y otro de un dispositivo registrando su token), ninguno pisa los cambios del otro y las metas guardadas corresponden siempre al perfil guardado.
- El Backend re-verifica el JWT: sin token o inválido → 401 `UNAUTHORIZED`, vencido → 401 `TOKEN_EXPIRED`. Un token válido de una cuenta que ya no existe también es 401.

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

- Front y Backend validan lo mismo (el Backend no confía en la DMZ), en memoria y sin escribir a disco. El JWT se verifica antes de leer el multipart.
- nginx corta antes: un body de más de 13 MB → 413 `PAYLOAD_TOO_LARGE`, con el `requestId` igual al header `X-Request-Id`. Lo que pasa lo bufferea en memoria y recién ahí lo manda al Front.
- `photo` es obligatoria: JPEG, PNG o HEIC de hasta 8 MB. `audio` es opcional: M4A de hasta 4 MB y 60 s. `note` es opcional, de hasta 500 caracteres. El tipo se detecta por el contenido del archivo, no por la extensión ni el `Content-Type` del cliente.
- Falta la foto, tipo no permitido, nota de más de 500 caracteres (sea cual sea el largo), un campo de más o un archivo en un campo que no es `photo`/`audio` → 400 `VALIDATION_ERROR`. Un archivo por encima del límite → 413 `PAYLOAD_TOO_LARGE`.
- El Backend lee la duración del audio del propio archivo (`moov/mvhd`); si no la puede leer o pasa de 60 s → 400.
- Orden en el Backend: genera el `mealId`, sube la media a `users/{userId}/meals/{mealId}/photo.{jpg|png|heic}` (y `audio.m4a`), crea la comida con `status: "processing"` y `localDate` (el día en la zona del perfil al llegar el pedido) y encola el job `{ mealId, requestId }` con `jobId = mealId`. Responde 202 sin esperar al Worker: con el Worker apagado el job queda en espera.
- Si falla la subida → 503 `SERVICE_UNAVAILABLE` y no queda nada. Si falla crear la comida → 500 `INTERNAL_ERROR` y se borra la media subida. Si falla encolar (Redis caído) → 503 `SERVICE_UNAVAILABLE`; la comida y la media quedan, con `status: "failed"` y `error.code: "ENQUEUE_FAILED"` para reprocesarla.
- **Racha (RF-10):** con la comida ya creada, y en paralelo con el encolado, se cuenta el `localDate` en `gamification` (se crea con un upsert la primera vez). Cuenta el registro, no el análisis: vale aunque después el análisis falle. Contra `streak.lastLogDate`: el mismo día no cambia nada; el día anterior (calculado con el calendario sobre `YYYY-MM-DD`, no restando 24 h) suma 1; sin registro previo o con algún día salteado vuelve a 1; un día anterior a `lastLogDate` (cambio de zona) no toca nada. Después se actualiza `best` y `lastLogDate`.
  - Es una sola escritura atómica, condicionada a que `localDate` sea posterior a `lastLogDate`: dos comidas a la vez el mismo día suman una vez. Si el upsert choca con el índice único (dos primeras comidas a la vez), se reintenta una vez.
  - La racha nunca rompe el registro: si falla se loguea con el `requestId` y se responde 202 igual. Se espera como mucho 300 ms; si tarda más, se responde sin esperarla (la escritura sigue).
  - Borrar comidas no recalcula la racha: un día que queda sin comidas ya está contado.

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

La forma depende del `status`:

- `processing`: solo `id`, `status`, `capturedAt` y `photoUrl`.
- `ready`: además `dish`, `items`, `kcal`, `macros`, `confidence` y `comment`, como en el ejemplo. Los valores son los del análisis **con las correcciones aplicadas** (ver [modelo de datos](modelo-datos.md#meals)), los mismos que suma el dashboard. Si no hay comentario, `comment` no viene: nunca es `null`. Puede faltar aunque el tono esté activo: si la IA del comentario falla, devuelve algo inválido o el filtro de seguridad lo descarta, la comida igual queda `ready`, sin comentario. `comment.tone` es el tono con el que se generó, y `text` tiene hasta 200 caracteres. Corregir la comida con `PATCH /meals/:id` no regenera el comentario.
- `failed`: además `error.code`, sin análisis. La API no manda un mensaje para el usuario: la app lo arma a partir del código.

| `error.code` | Quién lo escribe y cuándo | Mensaje que muestra la app |
|---|---|---|
| `NOT_FOOD` | Worker: la IA dice que la foto no es comida. No se reintenta y no consume cupo | "No encontramos comida en esta foto. Probá con otra en la que se vea el plato." |
| `ENQUEUE_FAILED` | Backend: no se pudo encolar el análisis (Redis caído). La comida y la media quedan para reprocesarla | "No pudimos analizar esta comida. Probá de nuevo en un rato." |
| `ANALYSIS_FAILED` | Worker: falló el último de los 3 intentos del análisis (2 reintentos con backoff exponencial, RNF-02). La comida y la media quedan | "No pudimos analizar esta comida. Probá de nuevo en un rato." |

- Nunca salen campos internos: `userId`, keys del bucket, `promptVersion`, `model`, `attempts`, `transcript`, `note` ni `corrections`. El id sale como string y las fechas en ISO.
- `photoUrl` es una URL GET firmada de vida corta (15 min, RNF-04). Se firma en cada request y nunca se guarda en la base.
- La respuesta lleva `Cache-Control: no-store`: la app consulta en loop mientras la comida está en `processing` y nunca tiene que usar una `photoUrl` vencida.
- Ritmo de la app (`app/features/meals/polling.ts`): consulta enseguida y se espacia de 1 s a 5 s (×1,5); pasados 30 s avisa que tarda más y consulta cada 15 s; a los 10 min deja de consultar sola. Nunca superpone pedidos, se pausa con la app en segundo plano o la pantalla sin foco, y corta con `ready`, `failed` o un 404. Si la imagen no carga (la `photoUrl` venció), vuelve a pedir la comida.
- La comida se busca por id **y** dueño en la misma consulta: una comida de otro usuario y un id inexistente responden el mismo 404 `NOT_FOUND`, con el mismo mensaje.
- Un `id` que no es un ObjectId (24 caracteres hex) → 400 `VALIDATION_ERROR`, en el Front y en el Backend.

### Historial del día

```http
GET /api/v1/meals?date=2026-10-06
GET /api/v1/meals?date=2026-10-06&cursor=MTc5MTI5ODcwMDAwMC42NmYx…
Authorization: Bearer <accessToken>
```
```json
{
  "items": [
    { "id": "66f1a…", "status": "ready", "capturedAt": "2026-10-06T11:05:00.000Z", "photoUrl": "https://…firmada…", "dish": "Tostadas con palta", "…": "…" },
    { "id": "66f1b…", "status": "processing", "capturedAt": "2026-10-06T15:40:00.000Z", "photoUrl": "https://…firmada…" }
  ],
  "nextCursor": null
}
```

- `date` es obligatoria, `YYYY-MM-DD` y un día real del calendario. Las comidas se filtran por `localDate` (el día en la zona del perfil al registrarlas), no por `capturedAt`: una comida de las 23:30 en Montevideo es de ese día aunque en UTC ya sea el siguiente.
- Orden por `capturedAt` ascendente (desempata el id), de a 20 por página (`MEALS_PAGE_SIZE`). `nextCursor` es `null` en la última página; si no, se manda tal cual como `cursor` para pedir la siguiente.
- El cursor es opaco para la app (base64url de la posición de la última comida de la página). Es estable: una comida nueva o borrada entre páginas no hace repetir ni saltear las demás.
- Cada item tiene **la misma forma que `GET /meals/:id`**, según su `status` y con las correcciones aplicadas (`toMealResponse` + `applyCorrections`). Cada `photoUrl` se firma en la request (15 min).
- Un día sin comidas no es un error: 200 con `{ "items": [], "nextCursor": null }`.
- Solo las comidas del usuario del token. Sin `date`, un `date` inválido o repetido, un `cursor` vacío o que no salió de la API, o cualquier otro campo en la query → 400 `VALIDATION_ERROR`. El Front valida la forma (`listMealsQuerySchema`, en `shared`); el Backend además decodifica el cursor.
- Una sola consulta sobre el índice `{ userId, localDate, capturedAt, _id }`, sin ordenar en memoria. La respuesta lleva `Cache-Control: no-store`.
- Tipo de la respuesta: `MealListResponse` (`shared`).

### Corregir una comida

```http
PATCH /api/v1/meals/66f1a…
Content-Type: application/json

{ "dish": "Milanesa napolitana con puré", "kcal": { "min": 800, "max": 900 } }
```

Responde 200 con la comida corregida, con la misma forma que `GET /meals/:id` en `ready` (los valores ya corregidos, `photoUrl` firmada y `Cache-Control: no-store`). El historial de `corrections` nunca sale.

Cada campo que cambió se registra en `corrections` con su valor anterior y nuevo (ver [modelo de datos](modelo-datos.md#meals)).

- Se pueden corregir `dish`, `items`, `kcal` y `macros`, con la misma forma que el análisis. Cada campo va completo: `items` es la lista entera de ingredientes (puede ser vacía) y `macros` lleva los tres rangos. Hace falta al menos uno.
- Se valida en el Front y en el Backend con el mismo esquema (`correctMealSchema`, en `shared`). Body vacío, un campo desconocido (en la raíz, en un ingrediente o en `macros`), un rango con `min > max` o con negativos, o un id que no es un ObjectId → 400 `VALIDATION_ERROR`.
- Topes: `dish` hasta 200 caracteres, cada `name` hasta 100 y hasta 50 ingredientes. `dish` y los nombres se guardan sin espacios al principio ni al final.
- Se guarda lo que manda el usuario: no se recalcula el total desde los ingredientes ni al revés. La app manda solo los campos que cambiaron y, si la persona cambió ingredientes sin tocar el total, manda también el total que sumó (ver [RF-06](requerimientos.md#rf-06--correcciones-persistentes)).
- El valor anterior (`from`) es el que ve el usuario, con las correcciones previas aplicadas, no el del análisis. Un campo que viene igual al valor actual no se registra; si no cambió ninguno, responde 200 sin tocar la base.
- `analysis` no se modifica: las correcciones se agregan a `corrections` (todas las del request en una sola escritura, con la misma `at`) y los valores finales salen de aplicarlas en orden (`applyCorrections`, la misma función que usa `GET /meals/:id`). El dashboard suma los valores corregidos.
- La comida se busca por id **y** dueño: una comida de otro usuario y un id inexistente responden el mismo 404 `NOT_FOUND`.
- Solo se corrige una comida `ready`. En `processing` o `failed` no hay análisis que corregir → 409 `MEAL_NOT_READY`, sin tocar la base.
- Dos PATCH a la vez no se pisan: la escritura solo se aplica si `corrections` sigue teniendo el largo que se leyó; si no, relee (el `from` pasa a ser lo que dejó el otro) y reintenta hasta 3 veces. Si pierde las 3 → 500 `INTERNAL_ERROR` sin escribir nada.
- Loguea `mealId`, los campos corregidos (`fields`) y `durationMs`; nunca los valores.

### Eliminar una comida

```http
DELETE /api/v1/meals/66f1a…
Authorization: Bearer <accessToken>
```

Responde 204 sin cuerpo: borró la foto, el audio (si lo había) y el documento.

- La comida se busca por id **y** dueño: una comida de otro usuario y un id inexistente responden el mismo 404 `NOT_FOUND`, sin tocar nada. Un id que no es un ObjectId → 400 `VALIDATION_ERROR`.
- Orden: primero la media del bucket, después el documento. Si el bucket falla → 503 `SERVICE_UNAVAILABLE` y la comida queda como estaba (se loguea el `mealId`); la app puede reintentar, porque borrar una key que ya no existe no falla. Así un 204 garantiza que no quedó media huérfana en el bucket. Si falla Mongo después de borrar la media, la comida queda sin foto hasta el reintento.
- Se puede borrar en cualquier `status`. Si el Worker todavía la está analizando, el job no encuentra la comida (o la foto) y se descarta sin escribir nada.
- Borrar no recalcula rachas pasadas (RF-10). El dashboard deja de sumarla al volver a pedirlo.

### Dashboard diario

```http
GET /api/v1/dashboard/daily?date=2026-10-26
Authorization: Bearer <accessToken>
```
```json
{
  "date": "2026-10-26",
  "consumed": {
    "kcal":    { "min": 1450, "max": 1820, "mid": 1635 },
    "protein": { "min": 80,   "max": 102,  "mid": 91 },
    "carbs":   { "min": 150,  "max": 190,  "mid": 170 },
    "fat":     { "min": 45,   "max": 60,   "mid": 53 }
  },
  "targets": { "kcal": 2100, "proteinG": 120, "carbsG": 240, "fatG": 70 },
  "meals": { "ready": 3, "processing": 1, "failed": 0 },
  "streak": { "current": 4, "best": 12 }
}
```

- `date` es opcional, `YYYY-MM-DD` y un día real del calendario. Sin `date` se usa el día de hoy en la zona del perfil (`profile.timezone`), y la respuesta dice cuál fue. Otro formato, un día que no existe (`2026-02-30`), `date` vacía o repetida, o cualquier otro campo en la query → 400 `VALIDATION_ERROR`, en el Front y en el Backend.
- El usuario sale siempre del token. Las comidas se filtran por `localDate` (el día del usuario), no por `capturedAt`.
- `consumed` suma solo las comidas `ready` del día, con las correcciones aplicadas (los mismos valores que `GET /meals/:id`). `min` es la suma de los mínimos, `max` la de los máximos y `mid` su punto medio. Se redondea a enteros recién en la respuesta: `mid` sale de las sumas sin redondear.
- `meals` cuenta las comidas del día por status. Las `processing` y `failed` no suman en `consumed`; con `failed` > 0 la app puede avisar que hay alguna para reintentar.
- `targets` es `users.targets` tal cual está guardada (con las mismas claves que `GET /users/me`); no se recalcula acá.
- Un día sin comidas no es un error: 200 con `consumed` en cero y `meals` en cero.
- Solo números: la respuesta no dice si lo consumido está por encima o por debajo de la meta (RNF-10). Cómo se muestra lo decide la app.
- Una sola agregación sobre el índice `{ userId, localDate, capturedAt, _id }` (usa el prefijo `{ userId, localDate }`); con `date`, la meta se busca en paralelo (RNF-01, < 1 s).
- La respuesta lleva `Cache-Control: no-store`: la app lo vuelve a pedir al volver a la pantalla.
- `streak` es la racha de días con al menos un registro (RF-10), leída de `gamification`. Siempre es respecto de **hoy** en la zona del perfil, aunque se pida otra `date`.
  - `current` es la racha guardada solo si el último registro fue hoy o ayer; si es más viejo, 0 (la racha guardada solo se actualiza al registrar, así que en la base puede seguir la vieja).
  - `best` es la máxima histórica, tal cual está guardada.
  - Un usuario que todavía no registró ninguna comida no tiene documento: las dos en 0.

### Wrapped semanal

```http
GET /api/v1/summaries/weekly/2026-W43
Authorization: Bearer <accessToken>
```
```json
{
  "week": "2026-W43",
  "from": "2026-10-19",
  "to": "2026-10-25",
  "metrics": { "avgKcal": 1840, "daysLogged": 6, "streak": 5, "topDish": "Milanesa con puré" },
  "insights": [
    "Registraste 6 de los 7 días: la app ya es parte de tu semana.",
    "De martes a sábado no cortaste: 5 días seguidos.",
    "La milanesa con puré fue la que más se repitió."
  ],
  "generatedAt": "2026-10-26T09:00:12.000Z"
}
```

- `week` es una semana ISO 8601 (`YYYY-Www`, de lunes a domingo) que exista en ese año: `W53` solo en los años que la tienen (2026 sí, 2025 no). Otro formato, `W00`, `W54`, una `W53` que no existe o cualquier query → 400 `VALIDATION_ERROR`, en el Front y en el Backend (`weeklySummaryParamsSchema`, en `shared`).
- `from` y `to` son el lunes y el domingo de la semana (`YYYY-MM-DD`); se calculan de `week`, no se guardan.
- El resumen se busca por `userId` del token y `week` en la misma consulta. Uno de otro usuario, uno inexistente y uno que todavía no está `ready` (`pending` o `failed`) responden el mismo 404 `NOT_FOUND`.
- Las métricas se explican en [modelo-datos.md](modelo-datos.md#weekly_summaries). `insights` son de 3 a 5 textos de hasta 140 caracteres. No salen `_id`, `userId`, `status` ni `promptVersion`.
- Lo genera el cron del Worker los lunes a las 06:00 (UTC-3) para la semana anterior; este endpoint solo lee. La respuesta lleva `Cache-Control: no-store`.
- Qué ve el plan free todavía no está definido (decisión abierta 4): el gating de premium llega con #40.

```json
{ "error": { "code": "NOT_FOUND", "message": "Recurso inexistente", "requestId": "a81f…" } }
```
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "La solicitud no es válida", "requestId": "a81f…" } }
```

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
| 409 | Email ya registrado, o corrección de una comida que no está `ready` (`MEAL_NOT_READY`) |
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
- Los errores del Backend con sobre válido llegan al cliente sin modificar. Si el Backend no está alcanzable o no termina de responder dentro del timeout (`BACKEND_TIMEOUT_MS`, 10 s por defecto), el Front responde `503 SERVICE_UNAVAILABLE`; si responde algo que no es un sobre válido, `500 INTERNAL_ERROR`. El Front no reintenta: si vence el timeout de una escritura, el Backend pudo haberla completado.
- Si la IA falla (error de red, timeout o una respuesta que no pasa la validación), el job reintenta con backoff y la comida queda en `processing`: nunca se pierde la media. Que la foto no sea comida no es un fallo de la IA: la comida pasa a `failed` con `NOT_FOOD` sin reintento.

El catálogo, `AppError` y el middleware de errores viven en `shared/` (paquete `@caloria/shared`) y los usan ambos servicios. El status se deriva del `code`: en el código se lanza `throw new AppError("MEAL_QUOTA_EXCEEDED")`, nunca se arma la respuesta a mano.

### Códigos de error

| `code` | HTTP |
|---|---|
| `VALIDATION_ERROR` | 400 |
| `UNAUTHORIZED`, `TOKEN_EXPIRED` | 401 |
| `MEAL_QUOTA_EXCEEDED`, `PREMIUM_REQUIRED` | 402 |
| `NOT_FOUND` | 404 |
| `EMAIL_TAKEN`, `MEAL_NOT_READY` | 409 |
| `PAYLOAD_TOO_LARGE` | 413 |
| `RATE_LIMITED` | 429 |
| `INTERNAL_ERROR` | 500 |
| `AI_UNAVAILABLE` | 503 |
| `SERVICE_UNAVAILABLE` | 503 (el Front no alcanza al Backend o vence el timeout) |

El middleware traduce además estos errores de librerías:

| Origen | `code` |
|---|---|
| `ZodError` | `VALIDATION_ERROR` (400) |
| JSON malformado | `VALIDATION_ERROR` (400) |
| Body por encima del límite, o cualquier otro límite de multer | `PAYLOAD_TOO_LARGE` (413) |
| multer con un campo de archivo inesperado (`LIMIT_UNEXPECTED_FILE`) o un campo de texto por encima de `fieldSize` (`LIMIT_FIELD_VALUE`) | `VALIDATION_ERROR` (400) |
| Ruta inexistente | `NOT_FOUND` (404) |
| Cualquier otro | `INTERNAL_ERROR` (500) |

### Logs

Una línea JSON por evento, con `requestId`, `service`, `level` y `msg`. Cada request deja una línea con método, ruta (sin query string), status y duración. Los 4xx se loguean sin stack y los 5xx con stack. Nunca se loguean bodies, el header `Authorization`, passwords, tokens ni emails; el logger además redacta esas claves y patrones si se cuelan.

# Prompts de pazdiaz15

## Sesión `2b4eb0f7-d8f1-4653-85c8-a201de365346` · 2026-10-12

### 2026-10-12 19:35

```text
Implementá el ticket: "Sobre de error único y requestId en Front y Back". Middleware de errores común para toda la API.
Referencia: `docs/api.md`. Revisá cómo están armados hoy el Front Service y el Backend antes de empezar, y reutilizá lo que ya exista (logger, paquete compartido, wrapper async).
Criterios de aceptación:
- Todas las respuestas de error de ambos servicios tienen la forma `{ error: { code, message, requestId } }`.
- El Front genera el `requestId` y lo propaga al Backend con `X-Request-Id`.
- El `requestId` aparece en los logs de ambos servicios.
- Nunca se exponen stack traces en las respuestas.
Decisiones:
- Catálogo de códigos y `AppError` en un módulo compartido por ambos servicios; el status se deriva del `code`, tipado como unión cerrada.
- El Front siempre genera un UUID nuevo e ignora el `X-Request-Id` que mande el cliente. También lo devuelve en el header de respuesta.
- El Backend usa el `X-Request-Id` recibido; si falta o es inválido, genera uno y loguea un warning.
- El middleware de errores mapea `AppError`, `ZodError` (400), JSON malformado (400), límite de tamaño o multer (413) y rutas inexistentes (404). Cualquier otro error → 500 con mensaje genérico, nunca `err.message`.
- Los errores del Backend con sobre válido pasan por el Front sin modificar. Si el Backend no responde o devuelve algo inválido, el Front responde su propio sobre (503 si no está alcanzable, 500 si no).
- Logs estructurados con `requestId` en cada línea. Stack trace solo en el log de los 5xx. Sin PII: nada de emails, passwords, tokens, bodies ni el header `Authorization`.
- Reemplazá las respuestas de error armadas a mano por `throw new AppError(...)`, sin cambiar otra lógica.

Cubrí cada criterio de aceptación, más: error inesperado sin filtrar el mensaje ni el stack, `X-Request-Id` del cliente ignorado, mismo requestId en Front y Backend, error del Backend que pasa intacto y Backend caído.
```

## Sesión `2c9b4514-5662-4110-b3ff-2520b91b008f` · 2026-10-12

### 2026-10-12 20:46

```text
Implementá el ticket: Claves RS256 y endpoints de register y login. Alta y login con email y contraseña; el Backend firma los tokens con la clave privada.
Referencias: `docs/requerimientos.md#rf-01--registro-y-login`, `docs/seguridad.md` y `docs/api.md. Reutilizá el sobre de error y `AppError` que cree en el pr anterior.
Criterios de aceptación:
- Script para generar el par de claves RS256 en local (fuera del repo).
- `POST /auth/register` devuelve 201 con access y refresh token.
- Email en minúsculas y único: repetido → 409 `EMAIL_TAKEN`.
- Contraseña de mínimo 8 caracteres; se guarda solo el hash bcrypt (cost 12).
- Login incorrecto → 401 con el mismo mensaje sea el email o la contraseña.
- Access token de 15 min con `{ sub, plan }`.
Decisiones:
- E script genera un par RSA de 2048 bits en una carpeta fuera del repo y muestra cómo configurar las variables de entorno. El Backend lee la privada y el Front solo la pública, ambas por variable de entorno (agregalas al `.env.example` sin valores). Si falta una clave, el servicio no arranca.
- Firma y verificación:  solo RS256. Al verificar, aceptar únicamente ese algoritmo (rechazar `none` y HS256).
- Access token: `sub` (userId) y `plan`, más `iat` y `exp`. Nada de email ni otra PII.
- Refresh token: opaco y aleatorio (32 bytes o más), 30 días. Se guarda solo su hash SHA-256 en `users.sessions` con `family` y `expiresAt`. No usar bcrypt para el refresh.
- Email: `trim` + minúsculas antes de validar y guardar. Además del índice único, capturar el error de clave duplicada de Mongo (11000) y devolver 409, por si llegan dos registros a la vez.
- Contraseña: entre 8 y 72 bytes (bcrypt ignora lo que pasa de 72). Nunca se loguea ni se devuelve.
- Login: si el email no existe, igual comparar contra un hash bcrypt de relleno para que el tiempo de respuesta no revele si la cuenta existe. Mismo error `UNAUTHORIZED` en ambos casos.
- Front: register y login son públicos: sin verificación de JWT, solo validación zod y reenvío al Backend.
- Perfil: register acepta el perfil inicial de `docs/api.md`, validado con zod. Si ya existe el cálculo de metas, usalo; si no, dejá un TODO.

Tests:
Cubrí cada criterio de aceptación, más: email con mayúsculas que choca con uno existente, contraseña de 7 y de 73 bytes, el hash guardado no es la contraseña, el access token se verifica con la clave pública y tiene `exp` a 15 minutos, un token firmado con otro algoritmo o con `alg: none` se rechaza, y el refresh guardado en la base es un hash.
```

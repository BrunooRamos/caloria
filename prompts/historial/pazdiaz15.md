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

## Sesión `d362d7c1-6fc3-4d78-9ee1-e387485768a5` · 2026-10-14

### 2026-10-14 19:33

```text
Tengo que implementar el ticket de refresh con rotación y logout que revoca la familia. La idea es que las sesiones usen un refresh token de 30 días y que se detecte cuando alguien reusa uno.

Para el contexto, fijate en docs/requerimientos.md, docs/seguridad.md y docs/api.md, que tiene el contrato de /auth/refresh y /auth/logout. Ya está hecho el register y el login, así que reutilizá lo que haya de ahí: cómo se genera y se hashea el refresh, cómo se firma el access y el AppError para los errores.

Los criterios de aceptación son estos: POST /auth/refresh tiene que invalidar el refresh que se usó y devolver un par nuevo de la misma familia; si alguien reusa un refresh que ya fue rotado, se revoca toda la familia; POST /auth/logout revoca los refresh de la familia y devuelve 204; y en users.sessions solo se guarda el hash del refresh, nunca el token.

Algunas cosas que pensé y quiero que se respeten:

Los refresh que ya se usaron no los borres, marcalos como rotados (con un rotatedAt o algo así), y lo mismo con los revocados. Si los borramos, cuando alguien reuse uno no lo vamos a encontrar y no hay forma de saber si es un reuso o un token inventado, así que se pierde la detección. Para buscarlos usá el hash SHA-256 del token que llega, y agregá un índice en sessions.tokenHash.

En el refresh, si el hash no existe, está vencido o revocado, devolvé 401. Si existe pero ya estaba rotado, eso es un reuso: revocá todas las sesiones de esa familia, dejá un warning en el log con el userId y la familia (el token no) y devolvé 401. Si está todo bien, marcalo como rotado y creá el nuevo con la misma familia y vencimiento a 30 días. Quiero que esto sea una operación atómica que solo funcione si el token todavía no estaba rotado, así si llegan dos refresh con el mismo token al mismo tiempo, uno gana y el otro se toma como reuso.

El access nuevo firmalo con el plan que tenga el usuario en la base en ese momento, no con el del token anterior, por si se pasó a premium. Y en todos los casos de refresh inválido devolvé el mismo UNAUTHORIZED con el mismo mensaje; no quiero que la respuesta deje ver que detectamos un reuso.

El logout pide JWT y recibe el refresh en el body para saber qué familia cerrar. Solo revocá la familia si es del mismo usuario que viene en el access. Que sea idempotente: si ya estaba revocada o el token no existe, igual devolvé 204.

Aprovechá cada vez que se escriben sesiones para sacar las que ya vencieron, así el array no crece para siempre.

En el Front, /auth/refresh es público, así que no verifica JWT, solo valida el body con zod y reenvía. /auth/logout sí verifica el JWT como el resto.

Para los tests, además de los criterios de aceptación, quiero cubrir que el refresh viejo deje de servir después de rotar y el nuevo funcione; que después de un reuso también quede inválido el refresh más nuevo de esa familia; que otras familias del mismo usuario (otro dispositivo) no se toquen; refresh vencido da 401; logout con un refresh de otro usuario no revoca nada; logout dos veces da 204 las dos; dos refresh simultáneos con el mismo token terminan con la familia revocada; y que en la base nunca quede el token en texto plano.

Cuando termines, pasame qué archivos tocaste, si tomaste alguna decisión distinta a lo que puse acá y cómo dieron los tests.
```

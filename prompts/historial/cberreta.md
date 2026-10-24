# Prompts de cberreta

## Sesión `c16234ef-8fee-425d-972a-c1c7fea7a75c` · 2026-10-14

### 2026-10-14 19:11

```text
Necesito que armes la base de navegación y comunicación con la API en la app Expo (`app/`). Antes de tocar nada, leé `docs/api.md`, `docs/seguridad.md` y la sección de organización del repo en `docs/arquitectura.md`, y revisá `app/package.json` para ver qué versiones de Expo y expo-router tenemos y qué librerías ya están instaladas. Ahí está el contrato de los endpoints de `/auth`, el formato del sobre de error y cómo funciona la rotación de refresh tokens, que es clave para este ticket.

Lo que tiene que quedar es esto: la navegación con expo-router separada en un grupo de auth (login y registro) y un grupo con sesión, donde por ahora alcanza con una home placeholder con un botón de logout. Las pantallas de login y registro pueden ser mínimas mientras funcionen; el onboarding con el perfil completo y el diseño final van en otro ticket. Protegé los grupos de la forma que corresponda a la versión de expo-router instalada.

El cliente HTTP va en `app/services/` y la URL base tiene que salir de una variable de entorno (`EXPO_PUBLIC_API_URL`), con un `.env.example` que lo documente, incluyendo que en el emulador de Android `localhost` es `10.0.2.2`. Quiero que el cliente sea tipado, agregue el Bearer, convierta el sobre de error de la API en un error propio con status, code, message y requestId, y que soporte `FormData`, porque lo siguiente que viene es `POST /meals` con multipart. Si no hay ya una librería instalada para esto, prefiero un wrapper sobre `fetch` antes que sumar dependencias.

Los tokens se guardan en `expo-secure-store`. Cuando una request vuelve con 401 y código `TOKEN_EXPIRED` (no cualquier 401: `UNAUTHORIZED` no tiene que disparar nada), el cliente refresca, guarda el par nuevo y reintenta esa request una sola vez. Si el refresh falla, se limpia la sesión y la app vuelve al login. Hay un detalle importante acá: el backend rota el refresh token en cada uso y, si detecta que se reusa uno viejo, revoca toda la familia. Eso significa que si varias requests reciben `TOKEN_EXPIRED` al mismo tiempo no pueden lanzar cada una su propio refresh, porque nos cerraríamos la sesión solos. Tiene que haber un único refresh en vuelo y las demás requests tienen que esperarlo. Tampoco tiene sentido intentar refrescar sobre los propios endpoints de `/auth`.

La sesión debería vivir en un store o contexto (en `app/store/` o `features/auth/`, lo que encaje mejor con lo que ya hay), con un estado de cargando, autenticado y no autenticado. El cliente HTTP necesita poder avisarle al store cuando la sesión expiró sin que los dos módulos queden importándose mutuamente. El logout llama a `/auth/logout` sin bloquear si falla y borra los tokens.

Al abrir la app, mientras se lee SecureStore, mantené el splash. Si hay un refresh token, probá refrescar: si anda, entra directo al grupo con sesión; si no, limpia y va al login. No quiero que se vea por un instante la pantalla equivocada.

Sumá tests del cliente HTTP con `fetch` mockeado que cubran el refresh exitoso con reintento, el refresh fallido que termina en logout, dos requests concurrentes que generan un solo refresh, y que un 401 que no es `TOKEN_EXPIRED` no refresque. Todo en TypeScript estricto, con lint y typecheck en verde.

Antes de implementar, contame tu plan: qué archivos vas a crear o modificar y qué decisiones tomaste, y esperá mi OK.
```

## Sesión `33d426ea-e71e-4a5e-8fdd-0ed68537e123` · 2026-10-19

### 2026-10-19 11:17

```text
Ahora vamos a hacer el Front Service (`front-service/`), la cara pública de `/api/v1` que corre en la DMZ detrás de nginx. Antes de empezar, leé `docs/arquitectura.md` (sobre todo la tabla de componentes, las reglas de comunicación y la organización del repo), `docs/seguridad.md` y `docs/api.md`, donde están los endpoints, el sobre de error y los códigos. Revisá también lo que ya existe en `front-service/` y en `infra/docker-compose.yml` para respetar la estructura de carpetas (`routes/`, `controllers/`, `middleware/`, `schemas/`, `clients/`, `config/`).

Los criterios de aceptación son estos: verifica el JWT con la clave pública y responde 401 si no hay token o es inválido; tiene esquemas zod para body, params y query de los endpoints de auth y perfil; register, login y refresh son rutas públicas; reenvía al Backend en `BACKEND_URL` y devuelve la respuesta tal cual; y no tiene acceso a Mongo, Redis ni a la clave privada.

Para la verificación del JWT, la clave pública entra por variable de entorno y el algoritmo se fija explícitamente en RS256, sin aceptar otro, para evitar ataques de confusión de algoritmo. Hay un detalle del que depende la app: un token vencido no es lo mismo que uno inválido. Si el token expiró, la respuesta tiene que ser 401 con código `TOKEN_EXPIRED`, porque es lo que dispara el refresh en el cliente; cualquier otro problema (sin header, firma mala, formato roto) es 401 `UNAUTHORIZED`. Las rutas públicas son `POST /auth/register`, `/auth/login` y `/auth/refresh`; `/auth/logout` y todo `/users/me` requieren token. El refresh no usa el access token, viaja en el body.

Los esquemas zod van en `schemas/` y cubren register, login, refresh, logout y `GET`, `PATCH` y `DELETE` de `/users/me`. Las reglas de validación salen de los criterios de RF-01 y RF-02 en `docs/requerimientos.md` y del modelo en `docs/modelo-datos.md`: email normalizado a minúsculas, password de al menos 8 caracteres, y en el perfil los enums de sexo, actividad y objetivo, edad entre 16 y 100 calculada desde `birthDate`, altura entre 100 y 250 cm, peso entre 30 y 300 kg y una zona horaria válida. El `PATCH /users/me` acepta cambios parciales del perfil, el tono y los push tokens. Los esquemas tienen que ser estrictos, rechazando claves desconocidas, y además hay que eliminar o rechazar cualquier clave con `$` o `.` como pide la sanitización NoSQL de `seguridad.md`. Lo que no valida responde 400 `VALIDATION_ERROR` con el sobre de error estándar, sin exponer detalles internos. Limitá el body JSON a 100 KB y respondé 413 `PAYLOAD_TOO_LARGE` si se pasa.

El reenvío va en un cliente en `clients/` que llama a `BACKEND_URL` con el mismo método, ruta y query, el body ya validado y el header `Authorization` original, porque el Backend vuelve a verificar el token. El Front genera el `requestId` de cada request, lo manda en `X-Request-Id` y lo incluye en sus logs. La respuesta del Backend se devuelve tal cual: mismo status, mismo body y los headers que importan, como `Content-Type` y `Retry-After`. Poné un timeout a la llamada y, si el Backend no responde o no está disponible, devolvé un error con el sobre estándar; proponeme qué código usar para ese caso, porque `api.md` no lo define. El mTLS entre Front y Backend es una decisión abierta, así que no lo implementes ahora, pero dejá el cliente armado de forma que sumarlo después sea solo configuración.

El Front no puede tener nada que le permita tocar datos: no instales drivers de Mongo ni de Redis, no leas la clave privada y validá las variables de entorno al arrancar con zod, de modo que el servicio solo conozca lo que necesita (puerto, `BACKEND_URL`, clave pública, timeout). Revisá que en `docker-compose.yml` el contenedor del Front no reciba credenciales de Mongo, Redis, storage ni IA. Los logs nunca incluyen tokens, passwords ni bodies con datos personales. Como corre detrás de nginx, configurá `trust proxy` para que la IP del cliente se lea bien.

Las rutas de comidas, dashboard y billing quedan fuera de este ticket; el `POST /meals` multipart va a necesitar reenvío en streaming y lo hacemos aparte.

Sumá tests con supertest y el Backend mockeado que cubran: rutas públicas sin token, rutas protegidas sin token, con firma inválida y con token vencido (verificando que el código sea `TOKEN_EXPIRED`), un token firmado con otro algoritmo rechazado, bodies inválidos y con claves `$` que dan 400, el reenvío de status, body y `Retry-After` tal cual, la propagación del `X-Request-Id` y el Backend caído. Todo en TypeScript estricto, con lint y typecheck en verde.

Fijate tambien las cosas que ya tenemos implementadas para que sea coherente.

Antes de implementar, contame tu plan con los archivos que vas a crear o modificar y las decisiones que tomaste, y esperá mi OK. Trabajá en la rama `feat/front-service-gateway`. Cuando termines, pasame un resumen de lo que hiciste, cómo lo pruebo a mano con `curl` (incluyendo cómo generar un par de claves y un token de prueba) y qué quedó pendiente.
```
### 2026-10-19 12:18

```text
arma el pr
```

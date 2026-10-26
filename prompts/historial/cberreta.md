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

## Sesión `13f854cd-a6d2-4c30-8fad-e9aaa53efdd7` · 2026-10-19

### 2026-10-19 12:51

```text
Antes de empezar, leé la skill `caloria-design` completa y revisá lo que ya existe en `components/`, `theme/`, `services/` y en el store de sesión, porque la idea es usar todo eso y no duplicar nada. Leé también RF-01 en `docs/requerimientos.md` y el sobre de error y los códigos en `docs/api.md`.

Los criterios de aceptación son estos: validación de email y contraseña en el formulario; mostrar los errores de la API según `error.code`; y que el logout desde el perfil borre los tokens.

Las pantallas de login y registro ya existen como placeholders en el grupo de auth; completalas. Se arman solo con los componentes base (`Screen`, `Text`, `Input`, `Button`) y los tokens del theme, sin estilos inline ni valores hardcodeados. En el login va el logo arriba, respetando las reglas de uso de la skill, y las dos pantallas tienen un link para pasar de una a la otra.

La validación del formulario sigue las mismas reglas que valida el Front Service: email con formato válido y contraseña de al menos 8 caracteres. Si te sirve, usá zod también en la app, pero no armes un paquete compartido entre servicios en este ticket. Los errores se muestran debajo de cada campo, usando el estado de error del `Input`, y aparecen al salir del campo o al intentar enviar, no mientras la persona todavía está escribiendo. El botón de enviar pasa a loading durante la request y no permite doble envío.

Cuidá los detalles de formulario en el teléfono: teclado de email y sin mayúscula automática en el email, `autoComplete` y `textContentType` correctos para que funcione el autocompletado de contraseñas en iOS y Android, un botón para mostrar u ocultar la contraseña con un target táctil de al menos 44, el botón de "siguiente" del teclado pasando al campo de contraseña y el de "ir" enviando el formulario, y que el teclado nunca tape los campos ni el botón.

Para los errores de la API, armá un único lugar que traduzca cada `error.code` a un mensaje para el usuario, pensado para reutilizarse en toda la app y no solo en auth. En login, un `UNAUTHORIZED` muestra el mismo mensaje sea el email o la contraseña lo que está mal, como pide RF-01. En registro, `EMAIL_TAKEN` se muestra en el campo de email. Cubrí también `VALIDATION_ERROR`, `RATE_LIMITED` (si viene `Retry-After`, que el mensaje lo tenga en cuenta), los errores internos, la falta de conexión y un mensaje genérico para cualquier código desconocido. Los textos en español rioplatense, cortos y en tono tranquilo, y los errores generales que no son de un campo se muestran en la pantalla con el estilo de error de la skill, nunca como alerta del sistema.

Revisá qué pide el Front Service para `POST /auth/register`. Si el endpoint exige el perfil en la misma llamada, no inventes los campos del perfil: el onboarding es otro ticket, así que avisame y definimos cómo encadenar el registro con ese paso.

Para el logout, agregá una pantalla de perfil en el grupo con sesión, accesible desde la home, con un botón de cerrar sesión que use la acción del store que ya existe (llama a `/auth/logout`, borra los tokens de SecureStore y vuelve al login). Pedí una confirmación antes de cerrar la sesión. El botón va en variante `secondary` o `ghost`: según la skill, `danger` queda reservado para errores técnicos.

Sumá tests unitarios de la validación del formulario y del mapeo de `error.code` a mensajes. Todo en TypeScript estricto, con lint y typecheck en verde.

Antes de implementar, contame tu plan con los archivos que vas a crear o modificar y las decisiones que tomaste, y esperá mi OK. Trabajá en la rama `feat/rf-01-auth-screens`. Cuando termines, pasame un resumen de lo que hiciste, cómo pruebo cada error a mano contra el Front Service y qué quedó pendiente.

Hacelo desde la branch de feat/rf-01-app-auth-base
para no generar conflictos.
```

## Sesión `a90b567c-5f5e-4ee6-ac4d-b68601bddcef` · 2026-10-26

### 2026-10-26 11:18

```text
Este ticket es el endpoint `GET /api/v1/meals/:id`, que devuelve el estado y el resultado del análisis de una comida. Antes de empezar, leé la sección "Consultar el análisis" de `docs/api.md`, la collection `meals` en `docs/modelo-datos.md`, RF-05, RF-06 y RNF-04 en `docs/requerimientos.md` y la parte de autorización y privacidad de la media en `docs/seguridad.md`. Revisá también lo que ya existe en `back-service/` (modelos, services de media, middleware de auth) y en `front-service/`, para seguir la estructura y los patrones que ya usamos.

Los criterios de aceptación son estos: devuelve el formato de `api.md` según el `status`; incluye una `photoUrl` firmada; y si la comida es de otro usuario o no existe, responde 404.

El grueso del trabajo va en el Backend. La comida se busca filtrando por el id y por el `userId` del token en la misma consulta, de modo que una comida ajena y una inexistente terminen exactamente igual: 404 `NOT_FOUND` con el sobre de error estándar, mismo mensaje y sin ninguna diferencia que permita saber si el id existe. Un id que no tiene formato de ObjectId tampoco puede romper nada ni devolver un 500.

La respuesta cambia según el estado, como dice `api.md`. Mientras está en `processing` trae solo `id`, `status`, `capturedAt` y `photoUrl`. En `ready` trae además el plato, los ingredientes, las kcal, los macros, la confianza y el comentario, todo con la forma de rangos del ejemplo. Los valores tienen que ser los del análisis con las correcciones del usuario aplicadas, como indica `modelo-datos.md`, para que esta pantalla coincida con lo que después suma el dashboard; revisá cómo quedó implementado el `PATCH /meals/:id`, si ya existe, y seguí la misma lógica. Si el tono del usuario está desactivado y no hay comentario, definí un criterio consistente (campo ausente o `null`) y aplicalo igual en todos lados. En `failed` se incluye `error.code`. El modelo de `meals` hoy no tiene dónde guardar ese código, así que proponeme cómo agregarlo y qué códigos tendría que escribir el Worker (por ejemplo, la foto que no parece comida de RF-05), y actualizá `docs/modelo-datos.md` y `docs/api.md` con lo que definamos.

Armá la transformación del documento a la respuesta como una función aparte y tipada, porque la vamos a reutilizar en el historial (`GET /meals`). Esa función decide qué sale y qué no: nunca se exponen campos internos como `userId`, las claves del bucket, `promptVersion`, `model`, `attempts`, la transcripción ni el historial de `corrections`. El id sale como string y las fechas en ISO.

La `photoUrl` se firma en cada request a través del service de media, con una vida de 15 minutos como máximo (RNF-04), y nunca se guarda una URL firmada en la base. Si el service de media todavía no tiene un método para firmar lecturas, sumalo detrás de la misma interfaz, sin acoplarlo a un proveedor, porque el storage todavía es una decisión abierta. Como la app va a consultar este endpoint repetidamente mientras la comida se procesa, la respuesta tiene que llevar headers que eviten que se cachee, así nunca se usa una URL vencida. Es un endpoint de lectura, así que tiene que responder en menos de un segundo (RNF-01).

En el Front Service, agregá la ruta como protegida, con un esquema zod para el parámetro `id`, y reenviala al Backend igual que las demás.

Sumá tests que cubran: la forma de la respuesta en cada uno de los tres estados; una comida en `ready` con correcciones, verificando que salen los valores corregidos; que no aparezca ningún campo interno; que una comida de otro usuario y un id inexistente devuelvan exactamente la misma respuesta 404; un id mal formado; que la `photoUrl` sea firmada y con la expiración correcta; y la request sin token. Todo en TypeScript estricto, con lint y typecheck en verde.

Antes de implementar, contame tu plan con los archivos que vas a crear o modificar y las decisiones que tomaste, incluyendo la del campo para el error, y esperá mi OK. Trabajá en la rama `feat/rf-05-get-meal`. Si hay cambios en las cosas documentadas, actualiza tambien esos md.
```

### 2026-10-26 11:58

```text
Este ticket es la pantalla para registrar una comida en la app Expo (`app/`). Antes de empezar, leé RF-03 y RNF-06 en `docs/requerimientos.md`, el endpoint `POST /meals` en `docs/api.md` y la skill `caloria-design` completa. Revisá también lo que ya existe: el cliente HTTP en `services/`, el mapeo de `error.code` a mensajes, los componentes base, la home del grupo con sesión y si ya hay una pantalla de resultado de la comida. Fijate además en `app/package.json` qué librerías de cámara e imágenes ya están instaladas.

Los criterios de aceptación son estos: sacar la foto con la cámara o elegirla de la galería; comprimir la imagen para que el lado mayor no pase de 1600 px antes de subirla; poder registrar una comida en 3 interacciones o menos desde la pantalla principal; y enviar el `POST /meals` y navegar al resultado.

El criterio de las 3 interacciones es el que más condiciona el diseño, así que quiero que lo pienses antes de elegir librerías. El camino principal sería tocar el botón de cámara en la home, sacar la foto y confirmar el envío. Tené en cuenta que algunas opciones, como la cámara nativa del image picker, agregan su propio paso de confirmación en iOS, que también cuenta como interacción. Elegí entre `expo-camera` y `expo-image-picker` (o una combinación, por ejemplo cámara propia con un acceso a la galería dentro de la misma vista) justificando la decisión por ese conteo, y documentá en el PR el recorrido exacto con cuántas interacciones tiene tanto el camino de cámara como el de galería.

El botón para registrar va en la home como botón flotante, con la sombra `float` de la skill. La vista previa de la foto antes de enviar usa los componentes base: el botón principal envía y uno secundario permite sacar otra. La vista de cámara es oscura por naturaleza y la skill solo define un tema claro, así que si necesitás colores para los controles sobre la cámara, proponé los tokens nuevos y agregalos al theme en vez de hardcodearlos.

Pedí los permisos de cámara y galería recién cuando hacen falta, con textos en español en la configuración de `app.json` para iOS. Si la persona los niega, mostrá una pantalla que explique para qué se usan y que ofrezca ir a la configuración del sistema, sin dejarla trabada.

Antes de subir, comprimí la imagen con `expo-image-manipulator`: redimensioná solo si el lado mayor pasa de 1600 px, respetando la orientación, y exportá a JPEG con una calidad razonable. Esto convierte de paso las fotos HEIC. Si después de comprimir la imagen sigue pasando de 8 MB, mostrá el error sin intentar subirla. Separá el cálculo del tamaño de destino en una función pura, así se puede testear.

El envío usa el cliente HTTP que ya tenemos, como `multipart/form-data` con el campo `photo`, sin fijar el `Content-Type` a mano para no romper el boundary. Asegurate de que el reintento automático por `TOKEN_EXPIRED` funcione también con este body. Mientras sube, mostrá un indicador de progreso y no permitas doble envío. Si falla, la foto no se pierde: la persona puede reintentar sin sacarla de nuevo. Los errores se muestran con el mapeo que ya existe; `MEAL_QUOTA_EXCEEDED` necesita un mensaje claro y tranquilo, y por ahora no lleva a ninguna pantalla de planes.

Cuando el Backend responde 202 con el `mealId`, navegá a la pantalla de resultado reemplazando la de captura, para que volver atrás no lleve de nuevo a la cámara. Si la pantalla de resultado todavía no existe, armá una mínima que muestre la foto y el estado "analizando"; el polling y el resultado completo van en otro ticket.

El audio y la nota de RF-04 también van en otro ticket, pero dejá la vista previa preparada para sumarlos después como opcionales, sin agregar pasos al camino principal.

Revisá si el Front Service ya reenvía `POST /meals` con multipart. Si no lo hace, no lo implementes en este ticket: avisame, porque va a necesitar reenvío en streaming y lo hacemos aparte.

Sumá tests unitarios de la función de redimensionado y del armado del `FormData`. Todo en TypeScript estricto, con lint y typecheck en verde. La cámara no funciona en el simulador de iOS, así que el flujo completo hay que probarlo en un dispositivo real de cada plataforma.

Antes de implementar, contame tu plan con los archivos que vas a crear o modificar, la librería que elegiste con el conteo de interacciones y cualquier token nuevo que necesites, y esperá mi OK. Trabajá en la rama `feat/rf-03-capture-meal`.
```

### 2026-10-26 13:02

```text
[Image #3] me gustaria aca alejar un poco el boton de ingresar y el crear una cuenta porque queda demasiado pegado a los inputs. lo mismo en crear la pantalla de crear una cuenta
```

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

## Sesión `6592e532-49b6-4541-9617-961d95a330b2` · 2026-10-24

### 2026-10-24 21:15

```text
Tengo que implementar en la app la parte de completar el perfil al registrarse y ver las metas calculadas.

Para el contexto, fijate en docs/requerimientos.md (la parte de RF-02, perfil y metas), en docs/api.md para el contrato de /auth/register y /users/me, y en el RNF-10 de contenido responsable. Para todo lo visual (colores, tipografía, espaciados, componentes) usá la skill caloria-design; cargala antes de empezar con las pantallas y seguila en todo, no quiero estilos inventados.

Los criterios de aceptación son estos: en el registro se pide sexo, fecha de nacimiento, altura, peso, actividad y objetivo; se toma la zona horaria del dispositivo; se muestran las metas que devuelve la API; el perfil se puede editar después y se ven las metas recalculadas; y hay un aviso visible de que la app no es consejo médico.

Algunas cosas que pensé y quiero que se respeten:

Antes de arrancar, revisá cómo está hecho hoy el registro en la app y qué acepta y devuelve el Backend en /auth/register y /users/me. Si al Backend le falta algún campo (por ejemplo la zona horaria) o no devuelve las metas, avisame antes de tocar el server, porque eso sería otro ticket.

El registro lo pensé como un flujo de varios pasos y no un formulario largo: primero email y contraseña, después los datos del perfil agrupados (por ejemplo sexo y fecha de nacimiento, después altura y peso, después actividad y objetivo), y al final se manda todo junto en un solo POST /auth/register. Que se pueda volver atrás sin perder lo cargado. Para la fecha de nacimiento usá un selector de fecha, y para altura y peso teclado numérico, en cm y kg.

Validá en la app con zod usando los mismos rangos que valida el Backend, para que el usuario vea el error en el campo antes de mandar. Igual, si la API devuelve error, mapeá el code a un mensaje entendible (por ejemplo EMAIL_TAKEN o VALIDATION_ERROR) usando el sobre de error que ya tenemos.

La zona horaria sacala del dispositivo con expo-localization y mandala en el registro sin preguntarle al usuario. Es importante porque el día y la racha se calculan con ella.

Las metas no se calculan en la app: se muestran tal cual las devuelve la API (kcal y macros). Después de registrarse, el usuario tiene que ver una pantalla con sus metas antes de entrar al inicio.

Para editar, una pantalla de perfil con los mismos campos ya cargados, que haga PATCH /users/me y muestre las metas nuevas con lo que responde la API, sin tener que salir y volver a entrar. Mientras guarda, que se vea que está cargando y que no se pueda tocar dos veces el botón.

El aviso de que no es consejo médico tiene que estar visible en la pantalla de metas y en la de perfil, no escondido en un menú. Algo como "CalorIA no reemplaza el consejo de un profesional de la salud". Y por el RNF-10, nada de juicios sobre el cuerpo: no mostrar IMC ni etiquetas tipo "sobrepeso", y que las opciones de objetivo tengan nombres neutros.

Organizalo como el resto de la app: las pantallas en app/, la lógica en features/ y las llamadas a la API en services/, reutilizando el cliente HTTP que ya maneja los tokens.

Si el proyecto ya tiene tests de componentes, agregá los de validación del formulario, que se mande la zona horaria en el registro, que se muestren las metas que llegan de la API y que al editar se actualicen.

Cuando termines, pasame qué archivos tocaste, si tomaste alguna decisión distinta a lo que puse acá y cómo probarlo en el simulador.
```

## Sesión `e5d29145-95e9-4973-8b89-5ecfa59a4cab` · 2026-10-25

### 2026-10-25 16:34

```text
Tengo que implementar el ticket del endpoint central del registro de comidas, el POST /meals.

Para el contexto, fijate en docs/requerimientos.md (la parte de RF-03), en docs/api.md en la sección de registrar una comida, y en el modelo de datos de meals. Reutilizá lo que ya tenemos: el sobre de error con AppError, el requestId y el middleware de auth en Front y Backend.

Los criterios de aceptación son estos: el endpoint recibe un multipart con photo, audio opcional y note opcional; sube la media al bucket y crea el documento en meals con status "processing" y localDate; encola el job en Redis con BullMQ y responde 202 con { mealId, status } en menos de un segundo; y si el Worker está apagado igual responde 202 y el job queda esperando en la cola.

Algunas cosas que pensé y quiero que se respeten:

En el Front, verificá el JWT y validá el multipart antes de reenviar: foto obligatoria de hasta 8 MB y solo jpeg, png o heic, audio opcional, y note opcional con un largo máximo razonable. El tipo de archivo chequealo por el contenido real y no solo por la extensión o el Content-Type que manda el cliente. Si algo no cumple, 400 o 413 según el caso. Como el Front es stateless, no escribas nada a disco: procesalo en memoria con los límites puestos y reenvialo al Backend.

En el Backend volvé a validar lo mismo, porque no confiamos en la DMZ. El límite de 60 segundos del audio validalo leyendo la duración del archivo; si no se puede leer, rechazalo.

El orden en el Backend quiero que sea este: primero generar el id de la comida, después subir la media al bucket, después crear el documento y por último encolar. Así la media queda guardada antes de cualquier otra cosa, que es lo que pide el RNF-02. Las keys del bucket armalas con el usuario y la comida, algo como users/{userId}/meals/{mealId}/photo.jpg, y que los archivos queden privados.

El localDate es el día de la comida en la zona horaria del usuario (la que guardamos en el perfil), en formato YYYY-MM-DD, calculado a partir del momento en que llega el pedido. Es lo que después usamos para el historial del día y la racha, así que agregá un índice en meals por userId y localDate.

Para la cola, usá BullMQ con una cola para el análisis de comidas. Como id del job usá el mealId, así si por algún motivo se encola dos veces no se duplica. En el job mandá solo el mealId y el requestId (esto resuelve el TODO que quedó del ticket del sobre de error), nada de datos del usuario ni la media; el Worker lee lo demás de Mongo. Configurale reintentos con backoff exponencial.

Pensemos qué pasa si algo falla en el medio. Si falla la subida al bucket, no se crea nada y respondés 503. Si falla la creación del documento después de subir la media, intentá borrar lo que se subió y respondés 500. Si falla el encolado porque Redis no está, no borres nada: marcá la comida como failed con un código de error para poder reprocesarla después, y respondés 503. En todos los casos logueá el detalle con el requestId.

El 202 tiene que salir apenas se encola, sin esperar nada del Worker. Logueá cuánto tarda el request así podemos ver que estamos debajo del segundo.

Fuera de alcance de este ticket: el control del cupo del plan free, la racha y el Worker en sí. Dejá un TODO donde iría el control de cupo.

Para los tests: multipart válido con y sin audio da 202 con el body correcto; el documento queda en processing con el localDate bien calculado para una zona horaria distinta a UTC (por ejemplo una comida a las 23:30 de Montevideo); el job aparece en la cola en estado de espera sin ningún Worker corriendo; foto de más de 8 MB da 413; un archivo que no es imagen renombrado a .jpg da 400; audio de más de 60 segundos da 400; sin foto da 400; sin token da 401; y los tres casos de falla de arriba. El bucket mockealo o usá MinIO, y para BullMQ usá un Redis real, el del docker compose si ya está.

Cuando termines, pasame qué archivos tocaste, si tomaste alguna decisión distinta a lo que puse acá y cómo dieron los tests.
```

## Sesión `cdda44ee-b16f-4029-8870-cbfee6632cf9` · 2026-10-26

### 2026-10-26 16:48

```text
Tengo que implementar el ticket del GET /dashboard/daily, que devuelve lo consumido contra la meta del día.

Para el contexto, fijate en docs/requerimientos.md (la parte de RF-09), en docs/api.md y en el modelo de datos de meals y users. Reutilizá lo que ya tenemos: auth, validación con zod, el sobre de error y el índice de meals por userId y localDate que agregamos en el ticket del POST /meals.

Los criterios de aceptación son estos: suma las kcal y los macros de las comidas en estado ready del día, como rango y como punto medio; devuelve la meta y la cantidad de comidas que siguen en processing; y responde en menos de un segundo.

Algunas cosas que pensé y quiero que se respeten:

El día viene por query como ?date=YYYY-MM-DD y es opcional: si no viene, se usa el día de hoy en la zona horaria del usuario. Validá el formato con zod en el Front y en el Backend; si no es una fecha válida, 400. Un día sin comidas no es un error: devolvé todo en cero, no un 404. El usuario sale siempre del token, nunca de la query.

Para filtrar usá el localDate de las comidas, no el capturedAt, así coincide con el día del usuario.

La suma de los rangos es así: el mínimo del día es la suma de los mínimos, el máximo es la suma de los máximos, y el punto medio es el promedio de esos dos. Lo mismo para proteína, carbohidratos y grasas. Redondeá a enteros en la respuesta, no antes de sumar.

Ojo con las correcciones: si el usuario corrigió una comida, hay que sumar el valor corregido y no el original de la IA. 

La meta sale de users.targets tal cual está guardada, no se recalcula acá. Además de las comidas en processing, devolvé también cuántas quedaron en failed, así la app puede avisar que hay alguna para reintentar.

En docs/api.md el dashboard figura también con la racha. Si ya existe la collection gamification con la racha, incluila; si no, dejá un TODO y no la inventes en este ticket.

No agregues mensajes ni campos que juzguen, tipo "te pasaste" o "excedido". El endpoint devuelve números; cómo se muestran es cosa de la app, y por el RNF-10 tiene que ser neutral.

Para que responda rápido, hacé la suma con una sola agregación de Mongo que use el índice, y buscá la meta del usuario en paralelo. Nada de traer todas las comidas y sumarlas en JavaScript.

La respuesta pensé que tenga más o menos esta forma, ajustala si algo no cierra con lo que ya hay:

{
  "date": "2026-10-26",
  "consumed": {
    "kcal":    { "min": 1450, "max": 1820, "mid": 1635 },
    "proteinG": { "min": 80,   "max": 102,  "mid": 91 },
    "carbsG":   { "min": 150,  "max": 190,  "mid": 170 },
    "fatG":     { "min": 45,   "max": 60,   "mid": 53 }
  },
  "targets": { "kcal": 2100, "proteinG": 120, "carbsG": 240, "fatG": 70 },
  "meals": { "ready": 3, "processing": 1, "failed": 0 }
}

Actualizá docs/api.md con la forma final de la respuesta.

Para los tests: día con varias comidas ready da la suma correcta de mínimos, máximos y punto medio; las comidas en processing y failed no se suman pero se cuentan; una comida corregida suma el valor corregido; sin date usa el día de hoy en la zona horaria del usuario (probalo con una hora en que UTC ya está en el día siguiente); día sin comidas da ceros; fecha inválida da 400; las comidas de otro usuario no se mezclan; y sin token da 401.

Cuando termines, pasame qué archivos tocaste, si tomaste alguna decisión distinta a lo que puse acá y cómo dieron los tests.
```

### 2026-10-26 17:06

```text
Al correr los tests del back-service, falló test/analyze-meal.test.ts. 
```

### 2026-10-26 17:35

```text
Tengo que implementar en la app el ticket de la pantalla principal con el progreso del día.

Para el contexto, fijate en docs/requerimientos.md (la parte de RF-09), en docs/api.md para la respuesta de GET /dashboard/daily, y en el RNF-10 de contenido responsable. Para todo lo visual usá la skill caloria-design; cargala antes de empezar y seguila en colores, tipografía, espaciados y componentes.

Los criterios de aceptación son estos: la pantalla muestra barras de kcal y macros consumidos contra la meta; indica las comidas que se están analizando; y se actualiza al volver después de registrar, corregir o borrar una comida.

Algunas cosas que pensé y quiero que se respeten:

Los datos salen solo de GET /dashboard/daily. La app no suma comidas ni recalcula nada, solo muestra lo que devuelve la API. Pedilo sin date, así el Backend usa el día de hoy en la zona horaria del usuario.

Las barras se llenan con el punto medio (mid) dividido la meta, pero el texto tiene que mostrar el rango, para mantener la idea de que son estimaciones. Algo como "1.450–1.820 kcal de 2.100". La de kcal que sea la principal y más grande, y abajo las tres de proteína, carbohidratos y grasas. Formateá los números con separador de miles en español.

Si el consumido pasa la meta, la barra queda completa y nada más: sin rojo, sin íconos de alerta y sin textos tipo "te pasaste" o "excedido". Mismo color que siempre. Esto es por el RNF-10 y es importante.

Si hay comidas en processing, mostrá un indicador tipo "1 comida analizándose" con una animación de carga, para que el usuario entienda que el total todavía va a cambiar. Si hay alguna en failed, un aviso tranquilo de que no se pudo analizar, que lleve a esa comida en el historial.

Para que se actualice, refrescá los datos cada vez que la pantalla gana foco (con useFocusEffect), así al volver de registrar, corregir o borrar ya se ve el cambio. Si el proyecto usa React Query o algo parecido, además invalidá la consulta del dashboard cuando se crea, corrige o borra una comida. Mientras haya comidas en processing, volvé a pedir los datos cada algunos segundos y cortá cuando no quede ninguna. Si ya tenemos el push de "análisis listo", que también dispare un refresco. Agregá también pull to refresh.

Cubrí todos los estados: cargando (con un esqueleto, no una pantalla en blanco), error con botón para reintentar, y día sin comidas con un mensaje amable y neutral. En todos los casos el botón para registrar una comida tiene que estar bien visible, porque el RNF-06 pide registrar en tres interacciones o menos desde esta pantalla.

Que las barras tengan accessibilityLabel con el valor y la meta, para que se lean bien con lector de pantalla.

Organizalo como el resto de la app: la pantalla en app/, la lógica y los componentes de las barras en features/ y la llamada a la API en services/.

Si el proyecto tiene tests de componentes, agregá los de: barras con los valores correctos, barra completa sin estilo de alerta cuando se pasa la meta, indicador de comidas analizándose, día vacío, estado de error, y que se vuelva a pedir el dashboard al ganar foco.

Cuando termines, pasame qué archivos tocaste, si tomaste alguna decisión distinta a lo que puse acá y cómo probarlo en el simulador.
```

## Sesión `bf5d41e8-0ec5-4a10-948b-3af45d2b5c38` · 2026-10-28

### 2026-10-28 20:45

```text
Tengo que implementar el ticket de la racha en gamification al registrar una comida, o sea el cálculo de los días consecutivos con registro.

Para el contexto, fijate en docs/requerimientos.md (la parte de RF-10) y en el modelo de datos de gamification. Esto se engancha en dos cosas que ya están hechas: el POST /meals, que ya calcula el localDate de cada comida, y el GET /dashboard/daily, que tiene un TODO donde iba la racha.

Los criterios de aceptación son estos: se crea el documento de gamification del usuario; el primer registro de un día consecutivo suma 1 y si se saltea un día vuelve a 1; se guarda la racha máxima; se usa la zona horaria del usuario y borrar comidas no recalcula rachas pasadas; y el dashboard devuelve la racha actual y la máxima.

Algunas cosas que pensé y quiero que se respeten:

La racha se actualiza en el POST /meals, al registrar, no cuando la comida termina de analizarse. Lo que cuenta es que el usuario registró algo ese día, aunque después el análisis falle. Usá el localDate que ya calcula el endpoint.

El documento de gamification se crea con un upsert la primera vez que el usuario registra una comida, así funciona también con los usuarios que ya existen. Asegurate de que haya un índice único por userId.

La lógica, comparando el localDate de la comida con el lastLogDate guardado:
- Si es el mismo día, no cambia nada.
- Si lastLogDate es justo el día anterior, la racha actual suma 1.
- Si no hay lastLogDate o hay al menos un día salteado, la racha actual vuelve a 1.
- Si por algún motivo el localDate es anterior al lastLogDate (por ejemplo, el usuario cambió de zona horaria), no se toca nada.
- Después se actualiza la máxima si la actual la superó, y lastLogDate pasa a ser el día de la comida.

El "día anterior" calculalo con aritmética de fechas de calendario sobre el string YYYY-MM-DD, no restando 24 horas, así no hay problemas con los cambios de horario de verano.

Si el usuario registra dos comidas casi al mismo tiempo el mismo día, la racha no puede sumar dos veces. Hacé la actualización atómica en Mongo, que solo se aplique si lastLogDate todavía no es ese día. Si el upsert inicial choca por la clave única porque llegaron dos a la vez, reintentá una vez.

La racha no puede romper el registro de la comida: si la actualización falla, logueá el error con el requestId y seguí respondiendo el 202. La comida es lo importante. Y cuidá que no se pase del segundo de respuesta.

Borrar una comida no toca la racha. Si un día queda sin comidas porque el usuario las borró, la racha de ese día ya está contada y queda así.

En el dashboard hay un detalle importante: la racha guardada solo se actualiza cuando el usuario registra, así que si alguien no registró ayer ni hoy, en la base sigue figurando la racha vieja. Entonces la racha actual que devuelve el dashboard tiene que ser la guardada solo si lastLogDate es hoy o ayer (en la zona horaria del usuario); si es más vieja, devolvé 0. La máxima se devuelve tal cual. Y la racha siempre se calcula respecto a hoy, aunque se pida el dashboard de otra fecha. Si el usuario todavía no tiene documento de gamification, devolvé las dos en 0.

Agregalo a la respuesta del dashboard como "streak": { "current": 4, "best": 12 } y actualizá docs/api.md.

Fuera de alcance: la mascota y las insignias.

Para los tests: primera comida crea el documento con racha 1; dos comidas el mismo día dejan la racha en 1; días consecutivos suman; saltear un día vuelve a 1 y la máxima se mantiene; una comida a las 23:30 de Montevideo cuenta para ese día y no para el siguiente; el día anterior se calcula bien con una zona que tenga horario de verano (por ejemplo America/New_York en el día del cambio); dos registros simultáneos el mismo día suman una sola vez; borrar una comida no cambia la racha; si falla la actualización de la racha, el POST /meals igual responde 202; y el dashboard devuelve 0 de racha actual cuando el último registro fue hace dos días o más.

Cuando termines, pasame qué archivos tocaste, si tomaste alguna decisión distinta a lo que puse acá y cómo dieron los tests.
```

### 2026-10-28 21:03

```text
Ahora tengo que implementar en la app el ticket de mostrar la racha en el dashboard. Revisá los cambios y la actualización de docs/api.md que hicimos recién para ver la forma exacta de la respuesta. 

Para el contexto, fijate también en docs/requerimientos.md (la parte de RF-10). Para lo visual usá la skill caloria-design; cargala antes de empezar y seguila.

El criterio de aceptación es que la racha actual y la máxima se vean en el dashboard.

Algunas cosas que pensé y quiero que se respeten:

Los datos salen de la misma respuesta del dashboard que ya usamos, no hagas otro pedido. Así la racha se actualiza con el mismo refresco que ya tiene la pantalla (al ganar foco, pull to refresh, etc.) y no hay que agregar nada para eso. Actualizá el tipo de la respuesta del dashboard en la app para incluir streak.

La racha actual que esté destacada, arriba en la pantalla, con un número grande y un ícono que siga la skill de diseño. La máxima más chica al lado o debajo, como dato secundario. Cuidá el singular y el plural: "1 día", "4 días".

Si la actual es igual a la máxima y es mayor a 1, mostrá un detalle positivo chico, tipo "tu mejor racha".

Cuando la racha actual es 0, nada de mensajes que hagan sentir mal al usuario, tipo "perdiste tu racha" o "rompiste tu racha". Algo neutro y que invite, como "Registrá una comida para empezar tu racha". Esto va en línea con el RNF-10.

Que tenga accessibilityLabel, por ejemplo "Racha actual: 4 días. Mejor racha: 12 días".

Fuera de alcance: la notificación de racha en riesgo.

Si el proyecto tiene tests de componentes, agregá los de: racha con valores normales, singular y plural, el detalle de mejor racha, y el estado en 0.

Cuando termines, pasame qué archivos tocaste, si tomaste alguna decisión distinta a lo que puse acá y cómo probarlo en el simulador.

```

## Sesión `cabf0397-ccba-4ac6-9db4-b14278cbd06b` · 2026-11-04

### 2026-11-04 13:39

```text
Tengo que implementar el ticket de feature gating del lado del servidor, o sea que el Backend sea el que controla el cupo del plan free y el acceso a las funciones premium.

Para el contexto, fijate en docs/requerimientos.md, en docs/api.md (los códigos MEAL_QUOTA_EXCEEDED y PREMIUM_REQUIRED) y en el modelo de users, que ya tiene plan y quota: { month, used }. En el POST /meals quedó un TODO donde iba el control de cupo; arrancá por ahí.

Los criterios de aceptación son estos: POST /meals verifica el cupo antes de encolar y, si no hay cupo, responde 402 MEAL_QUOTA_EXCEEDED; las funciones premium sin plan premium responden 402 PREMIUM_REQUIRED; el contador se reinicia cada mes y los análisis que terminan en failed no consumen cupo; y todo se prueba llamando a la API directamente, sin pasar por la app.

Algunas cosas que pensé y quiero que se respeten:

Todo el control va en el Backend. El Front no decide nada de esto, y la app tampoco: puede mostrar el cupo, pero la regla la aplica el servidor. Y el plan leelo siempre de la base, no del plan que viene en el JWT, porque el token puede tener hasta 15 minutos y el usuario pudo haber cambiado de plan en el medio.

El límite del plan free que sea configurable por variable de entorno (agregala al .env.example), no un número suelto en el código. Los usuarios premium no tienen cupo.

El mes se calcula en la zona horaria del usuario, en formato YYYY-MM, igual que hacemos con el localDate. El reinicio no necesita un cron: si quota.month es distinto del mes actual, se considera que el usuario tiene 0 usados y se pisa el mes al consumir.

El control y el consumo tienen que ser una sola operación atómica en Mongo: un update que solo se aplique si el mes es el actual y used es menor al límite (o que reinicie si el mes cambió), y que sume 1. Si no se aplica, es que no hay cupo. Nada de leer, comparar en JavaScript y después escribir, porque si el usuario manda varias fotos a la vez podría pasarse del límite.

En el POST /meals, el cupo se reserva antes de subir la media, así no guardamos archivos de comidas que igual vamos a rechazar. Guardá en el documento de la comida en qué mes consumió cupo (algo como quotaMonth), para poder devolverlo después.

Para que los failed no consuman: cuando una comida termina en failed (en el Worker, después de agotar los reintentos, y también en el caso del POST /meals cuando falla el encolado o la creación del documento), se devuelve el cupo con un $inc de -1, solo si quotaMonth sigue siendo el mes actual del usuario. Si el mes ya cambió, no se toca nada. Esa devolución tiene que ser idempotente: marcá la comida (por ejemplo quotaRefunded: true) y que solo se devuelva si todavía no estaba marcada, así un job reintentado o un fallo repetido no devuelve dos veces. Y que el contador nunca quede negativo.

El 402 MEAL_QUOTA_EXCEEDED usa el sobre de error de siempre. En el message poné algo claro y neutro, que diga cuándo se renueva el cupo. Logueá el rechazo con el requestId y el userId.

Para las funciones premium, hacé un middleware requirePremium que se pueda poner en cualquier ruta, y aplicalo a las que docs/requerimientos.md marca como premium y ya existan. Si alguna todavía no existe, dejá anotado dónde va. Si hay una ruta que tiene una versión free y una premium (por ejemplo un resumen parcial y uno completo), decidilo dentro del controller y no con el middleware; avisame cuáles encontraste.

Si ya existe GET /billing/plan, que devuelva los análisis restantes del mes calculados con la misma lógica (con el reinicio de mes incluido). Si no existe, no lo crees en este ticket.

Para el criterio de probar sin la app, quiero dos cosas: tests de integración que peguen a la API por HTTP con supertest, y un script en scripts/ (o una sección en docs/) con los curl para reproducirlo a mano: registrarse, mandar fotos hasta agotar el cupo y ver el 402, y llamar a una ruta premium con un usuario free.

Para los tests: usuario free con cupo disponible da 202 y used sube 1; con el cupo agotado da 402 MEAL_QUOTA_EXCEEDED, no se sube nada al bucket ni se crea el documento ni se encola; usuario premium no tiene límite; con quota.month del mes pasado se reinicia y deja registrar; el cambio de mes se calcula con la zona horaria del usuario (por ejemplo el 31 a las 23:30 de Montevideo sigue siendo ese mes); varias requests simultáneas con un solo lugar libre dejan pasar solo una; una comida que termina en failed devuelve el cupo; un failed procesado dos veces devuelve una sola vez; un failed de un mes anterior no toca el contador actual; una ruta premium con usuario free da 402 PREMIUM_REQUIRED y con premium funciona; un usuario que pasó a premium hace segundos ya puede entrar aunque su token diga free.

Cuando termines, pasame qué archivos tocaste, qué rutas quedaron marcadas como premium, si tomaste alguna decisión distinta a lo que puse acá y cómo dieron los tests.
```


### 2026-11-04 19:22

```text
me das una descripcion def pr con los cambios impelemntados?
```

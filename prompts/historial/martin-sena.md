# Prompts de Martin Sena

## Sesión `957c1600-dbba-4800-9aa3-172966136e04` · 2026-10-21

### 2026-10-21 14:08

```text
Tenemos que implementar este ticket: https://github.com/BrunooRamos/caloria/issues/14, vamos a planificar como tenemos que hacerlo, discutamos decisiones hasta llegar a un plan de implementacion
```

### 2026-10-21 14:19

```text
Perfecto, guarda el plan el prompts/plans linkeado al issue con su nombre
```

### 2026-10-21 14:21

```text
Aprobado el plan, implementalo.
```

## Sesión `1c274a6e-d7ce-478e-aa0a-bf31c5c76a66` · 2026-10-25

### 2026-10-25 21:17

```text
Che, estoy en la rama front-y-nginx-multipart-con-l-mites-de-tama-o-y, que es del issue #16 (multipart con límites de tamaño y tipo). Fijate el issue con gh issue view 16.

Ojo que casi todo ya quedó hecho en el PR #66 (el de post-meals): la validación por contenido en shared/src/meals.ts, multer en memoria en el front, el reenvío al back y el 413 en nginx. No lo rehagas. Faltan unas puntas que quiero cerrar:

1. nginx está escribiendo la foto a disco. En la location de /api/v1/meals el client_body_buffer_size quedó en el default, así que todo lo que pase de 16 KB va a un archivo temporal. Quiero que quede en memoria, así que subilo a 13m como el client_max_body_size. Dejá el buffering prendido (nada de proxy_request_buffering off), así nginx sigue bancando a los clientes lentos.

2. Nunca probamos la config de nginx. Agregá algo al CI que corra nginx -t (con --add-host front:127.0.0.1 para que resuelva el upstream). Sumale un smoke test con curl: un POST de más de 13 MB a /api/v1/meals tiene que devolver 413 con el JSON de PAYLOAD_TOO_LARGE y un requestId igual al header X-Request-Id. Uno chico tiene que pasar. Si queda más prolijo como script en scripts/, metelo ahí, pero que lo pueda correr local con Docker.

3. Una nota larga a veces da 400 y a veces 413. Entre 501 y 2000 caracteres zod la rechaza con 400, pero arriba de 2000 salta el LIMIT_FIELD_VALUE de multer y sale 413. En docs/api.md dijimos que nota larga es 400. Corregilo en toAppError (shared/src/error-handler.ts) y agregá tests en shared y en front. Fijate también que no se rompa nada en los tests del back.

Lo de AAC suelto no lo toques: la app graba m4a y el back necesita el moov para leer la duración.

Mantené el estilo del repo (comentarios cortitos en español) y, si cambia algo documentado, actualizá los docs. Cuando termines, corré lint, typecheck y los tests, y pasame cómo salieron. No commitees todavía, que lo quiero revisar antes.
```

## Sesión `46a8b12e-f90c-494b-aaf5-8215add760c0` · 2026-10-25

### 2026-10-25 21:31

```text
Estoy en la rama del issue #17, el del worker con BullMQ (gh issue view 17 para ver qué pide). Parte ya quedó hecha con el PR de post-meals: la cola meal-analysis y el job { mealId, requestId } están en back-service/src/jobs/meal-analysis.ts, y el servicio worker ya está en el compose. Lo de encolar del lado del Back no lo toques. Lo que falta es que el worker consuma de verdad, porque hoy src/worker.ts es un console.log y nada más.

Lo primero es la config. El worker no puede usar loadConfig porque pide JWT_PRIVATE_KEY, y esa clave no tiene que llegarle al worker. Hacele una config aparte con Mongo, Redis, el storage y una WORKER_CONCURRENCY para la concurrencia. Por defecto que valga 2, y si viene cualquier cosa que no sea un entero positivo, que no arranque. Acordate de agregarla al .env.example y al compose.

El Worker de BullMQ ponelo en jobs/ junto a la cola, usando la misma constante del nombre. Ojo con la conexión: el Worker necesita maxRetriesPerRequest: null en IORedis, así que no reuses la de la cola, que está pensada para fallar rápido. Dejale un prefix opcional como tiene la cola, que nos sirve para los tests.

La lógica de cada job quiero que quede en un processor aparte, para poder testearla sin Redis. Lee la meal de Mongo. Si no existe, logueá un warn y terminá el job sin error, porque reintentar no la va a hacer aparecer. Si ya no está en processing, salteala, así un job repetido no pisa nada. Después baja la foto (y el audio si hay) del bucket. Para eso hace falta un download(key) en el MediaService que devuelva Uint8Array, con timeout como el upload. Si falla Mongo o MinIO, que tire el error y BullMQ reintente con las opciones que ya están. Al final le pasás meal + foto + audio a un analyze que se inyecte desde afuera. Por ahora que no haga nada y deje la meal en processing, que eso lo resolvemos en el #18.

Para los logs usá el logger de shared con service: "worker". Por cada job necesito ver mealId, requestId, el intento y cuánto tardó, salga bien o mal. Si falla, mandá el error con serializeError y que se vea si va a reintentar. Ni la media ni la nota del usuario van al log.

En worker.ts conectá Mongo con connectMongo y arrancá el worker. Con SIGTERM o SIGINT cerrá primero el worker, que espera los jobs que están corriendo, y después Mongo. Si no puede arrancar, que salga con 1 igual que el index.ts. Sumá también un dev:worker en los scripts para levantarlo local.

Los tests del processor hacelos con mongodb-memory-server y un media fake: que la meal no exista, que ya no esté en processing, el caso feliz con foto y audio, y que un error del bucket se propague. Agregá uno contra Redis real que encole con createMealAnalysisQueue y verifique que el worker lo consume, salteándolo si no está REDIS_TEST_URL, como hacen los de meals.test.ts. El download sumalo al test de integración de media.

No te metas con la IA (#18), ni con el estado failed ni el campo attempts (#35), ni con la transcripción (#23).

Comentarios cortitos en español como en el resto del repo, y si algo de lo documentado cambia, actualizá el README del back y docs/arquitectura.md. Al final corré lint, typecheck y los tests y contame cómo salieron. No commitees, que lo quiero revisar primero.
```

## Sesión `55533f30-15b5-4712-928f-925978da1199` · 2026-10-25

### 2026-10-25 21:49

```text
Estoy en la rama del issue #18, el del prompt de análisis y la llamada a la IA de visión (mirá qué pide con gh issue view 18). El worker del #17 ya está mergeado acá. Lee la meal, baja la foto y el audio, y le pasa todo a un analyze que se inyecta en worker.ts y que hoy no hace nada. Lo que hay que hacer es que ese analyze analice de verdad. El esquema de analysis en models/Meal.ts y el estado failed con error.code ya existen. Usalos y no cambies la forma del documento sin avisarme.

Vamos con OpenAI. En docs/requerimientos.md el proveedor figura como pregunta abierta (la 11): marcala como resuelta, igual que la 12.

1. El prompt. Creá prompts/analisis-comida.md con autor, versión y fecha en un frontmatter. El prompt de sistema va en el cuerpo. El worker lo lee una sola vez al arrancar, y de ese frontmatter sale el promptVersion que se guarda en la meal. Si falta el archivo o no tiene versión, que el worker no arranque. Hoy el Dockerfile del back no copia prompts/: sumalo, que el contexto del build ya es la raíz del repo. Tiene que pedir plato, ingredientes con gramos y kcal en rangos, kcal total, macros (proteína, carbos y grasas) en rangos y confidence entre 0 y 1. También tiene que poder decir que la foto no es comida. Ni la nota ni la transcripción van todavía, eso es del #23. Igual dejá armado el mensaje para que después se puedan sumar sin reescribirlo.

2. El service de IA. Ponelo en services/, detrás de una interfaz chica que reciba la foto y devuelva el análisis o "no es comida". Así los tests usan un fake y nunca le pegan a OpenAI. Usá structured outputs con JSON schema, pero no te fíes de eso: la respuesta se valida igual con zod. Los rangos tienen que tener min ≤ max y no ser negativos, y confidence tiene que estar entre 0 y 1. Ponele timeout a la llamada, como el upload y el download del MediaService.

3. Las claves. OPENAI_API_KEY y el modelo (OPENAI_VISION_MODEL, con un default que sea un modelo de visión vigente; fijate en la doc de OpenAI) van solo en loadWorkerConfig. Nada de loadConfig del back. Si falta la clave, el worker no arranca. En el compose la clave va únicamente en el servicio worker. Reemplazá el AI_API_KEY genérico del .env.example. Ojo con la red: erna, que es internal: true, yasí no sale a internet. Sumale una red con salida solo a él, sin abrirle nada más a
Mongo ni a Redis.

4. HEIC. shared acepta JPEG, Pacepta HEIC. Fijate si hay unaforma prolija de convertirla a JPEG en el worker. Si para eso hace falta una dependencia
nativa pesada (sharp con libhe, no la metas: frená y contamelas opciones.

5. El resultado, en el analyze que se inyecta en el processor:
   - Si zod rechaza la respues error y que reintente BullMQcon las opciones que ya tiene la cola. La meal sigue en processing.
   - Si es comida, guardá analodel y pasala a ready.
   - Si no es comida, pasala a failed con error.code "NOT_FOOD" y sin reintento. El
mensaje que ve el usuario lo ade, así que documentalo endocs/api.md.
   - En los dos casos, el updacessing", así un job repetido no pisa nada.
   - El cupo todavía no está intes, pero dejá escrito endocs/requerimientos.md (RF-14) que el conteo tiene que excluir las failed, así NOT_FOOD
no consume cupo.

6. Logs. Usá el logger del jobPor llamada quiero ver modelo,promptVersion, cuánto tardó, los tokens que consumió y el resultado (ready o NOT_FOOD).
Si zod rechaza, logueá solo lofoto, la respuesta cruda y lanota no van al log.

Tests: processor con mongodb-memory-server y un fake de la IA, cubriendo el caso feliz
(queda ready con promptVersionnválida (min > max o confidence1.5: tira error y queda en processing), no es comida (queda failed con NOT_FOOD) y una
meal que cambió de estado en e también la carga del prompt(sin versión no arranca) y loadWorkerConfig sin OPENAI_API_KEY. Ninguno le pega a OpenAI
de verdad.

No te metas con los reintentosiled después de agotarlos ni elcampo attempts (#35), ni con la transcripción y la nota (#23), ni con el compounding
(#30), ni con el comentario ni

Comentarios cortitos en españoo. Actualizádocs/arquitectura.md, docs/modelo-datos.md (el código NOT_FOOD), docs/api.md y el README del back. Fijate que el CI no ueva. Al final corré lint,typecheck y los tests y contame cómo salieron. No commitees, que lo quiero revisar primero.
```

## Sesión `d05b1650-1216-4d03-8078-7723341012e8` · 2026-10-26

### 2026-10-26 21:51

```text
Estoy en la rama del issue #22, el de grabar audio de hasta 60 segundos en la app (mirá qué pide con gh issue view 22 y RF-04 en docs/requerimientos.md). Todo lo del servidor ya está hecho: shared acepta el campo audio en el POST /meals (M4A de hasta 4 MB, AUDIO_MAX_BYTES y AUDIO_MAX_SECONDS en shared/src/meals.ts), el front lo reenvía, el back lee la duración del moov/mvhd y rechaza con 400 lo que pase de 60 s, y el worker ya lo baja del bucket. No toques back-service, front-service ni shared. Lo que falta es solo la app: grabar, escuchar, regrabar o descartar, y mandarlo en el mismo POST que la foto.

Antes de escribir código leé app/AGENTS.md. Estamos en Expo SDK 58: buscá la API de grabación y reproducción en la doc versionada (docs.expo.dev/versions/v58.0.0/) y no la escribas de memoria. Usá expo-audio, instalado con npx expo install expo-audio.

1. Permisos y config. Sumá el plugin de expo-audio en app.json con un texto de permiso de micrófono en el tono de los otros ("CalorIA usa el micrófono para que cuentes cómo preparaste tu comida…"). Ojo que hoy expo-camera y expo-image-picker tienen microphonePermission: false y recordAudioAndroid: false. Fijate que eso no borre el NSMicrophoneUsageDescription ni el RECORD_AUDIO que agrega expo-audio, y revisalo con npx expo config. La cámara sigue sin necesitar el micrófono. El audio es opcional, así que si niegan el permiso no se bloquea nada: se avisa y se puede seguir mandando solo la foto.

2. El formato. El back solo acepta MP4/M4A con AAC (brands M4A, mp42, isom, 3gp4) y necesita el moov para leer la duración. Configurá la grabación para que salga eso en iOS y en Android, y elegí un bitrate que deje 60 s bastante por debajo de los 4 MB. Nada de AAC suelto ni de 3gp/amr.

3. El límite. Que corte sola a_MAX_SECONDS de shared o unaconstante de la app con un comentario que lo referencie (fijate qué importa ya la app de shared). Mostrá el tiempo que a. El back tolera medio segundo de más, no más que eso. Si la app pasa a segundo plano o se sale de la pantalla          mientras graba, cortá la graba
                                                                                         4. La UI. Va en el PreviewStepde enviar. Tiene que tener losestados sin audio → grabando → grabado. Con audio grabado se puede escuchar              (play/pausa), regrabar o descaacá la lógica a un hook enfeatures/meals (algo como useAudioNote) y la parte visual a un componente aparte.        Acordate de soltar el player y y de frenar la reproducción alenviar o al regrabar. Si iOS lo necesita, configurá el modo de audio para poder grabar y para que suene en modo silenciqueda deshabilitado, como yahace la foto. "Sacar otra" vuelve a la cámara: decidí si conserva el audio o lo descarta y contámelo.

5. El envío. MealDraft pasa a  buildMealForm lo agrega como"audio" con File de expo-file-system, igual que la foto. Sin audio, el form queda
exactamente como hoy. Revisá lRS, porque ahora unVALIDATION_ERROR o un PAYLOAD_TOO_LARGE pueden venir por el audio (por ejemplo, la
duración) y hoy todos hablan dos para que no mientan. El texto de "Subiendo foto…" también.

Para la UI seguí la skill caloria-design: colores, tamaños, espaciado y radios salen de
theme/, y los íconos de lucideesto. Accesibilidad: labels enlos botones de grabar, play, regrabar y descartar, y que el tiempo restante se anuncie
sin spamear al lector de panta

Tests con jest-expo, mockeandockean expo-camera yexpo-image-picker en __tests__/capture-screen.test.tsx: buildMealForm con y sin audio,
que corte sola a los 60 s (conel grabador mockeado), descartar y regrabar, que enviar con audio mande los dos archivos en el mismo POST, y que con el
micrófono negado igual se pued

No te metas con la transcripciel audio en el prompt (#23), nicon el campo note en la app, que no está en este issue. Tampoco con los builds de EAS
(#49).

Comentarios cortitos en españoo. Si cambia algo documentado,actualizá los docs (docs/api.md no debería cambiar), y marcá en RF-04 los checks que queden cumplidos. Al final corests de la app y contame cómosalieron. No commitees, que lo quiero revisar primero.
```

## Sesión `853ca5ec-ae17-4057-90f3-0ba220c07f64` · 2026-10-26

### 2026-10-26 22:21

```text
Estoy en la rama del issue #23, el de la transcripción del audio como contexto del análisis (mirá qué pide con gh issue view 23 y RF-04 en docs/requerimientos.md). Lo de antes ya está mergeado acá. La app graba el M4A (#22), el back lo sube y el worker lo baja del bucket: el processor ya le pasa `audio` al analyze, pero hoy nadie lo usa. El analyze del #18 manda solo la foto a OpenAI. En userContent (services/vision.ts) quedó el comentario de que la transcripción y la nota se suman como partes input_text: es eso. Los campos transcript y note ya existen en models/Meal.ts y en docs/modelo-datos.md, así que no cambies la forma del documento sin avisarme. La `note` ya la valida shared (hasta 500 caracteres) y la guarda el back, así que no toques shared, front-service ni el POST /meals.

1. El service de transcripción. Ponelo en services/, separado de vision.ts, detrás de una interfaz chica que reciba el audio y devuelva el texto. Así los tests usan un fake y nunca le pegan a OpenAI. Usá la API de transcripción de OpenAI con el SDK que ya está instalado. Fijate en la doc qué modelo de speech-to-text está vigente y si acepta M4A tal cual lo graba la app; no lo escribas de memoria. Pasale el idioma español. Ponele timeout y maxRetries: 0, igual que a la visión, porque los reintentos son de BullMQ. Si la transcripción viene vacía o es solo ruido, tratala como si no hubiera audio.

2. La config. OPENAI_TRANSCRIPTION_MODEL va en loadWorkerConfig, con un default vigente, igual que OPENAI_VISION_MODEL. Nada de loadConfig del back. Sumala al infra/.env.example y al servicio worker del compose. La clave es la misma OPENAI_API_KEY y la red de salida ya existe, así que no abras nada más.

3. El flujo, en createAnalyzeMe
   - Si hay audio, transcribí pen meals.transcript con el mismo filtro status: "processing", así un job repetido no pisa nada.
   - Si la meal ya tiene transc falló la visión), reusalo y nolo vuelvas a transcribir, que se paga dos veces.
   - Si falla la transcripción el error y BullMQ reintente conlas opciones que ya tiene la cola. La meal sigue en processing. Si te parece mejor
seguir solo con la foto, frená
   - Sin audio, el análisis tiene que quedar exactamente como hoy: no se llama al
transcriptor y el mensaje lleva
   - Ojo con RNF-01 (menos de 15 s en el p90): si se puede, que la transcripción corra
en paralelo con la conversión d

4. El mensaje y el prompt. Cambpara que reciba la imagen más el transcript y la note opcionales, y que userContent los sume como partes input_text, bien separados y rotulados ("Audio del usuario:", "Nota del usuario:"). Si no vienen, no se agrega nada. Actualizá prompts/analisis-comida.md y subile la versión en el frontmatter, que de ahí sale el promptVersion. Tiene que explicar cómo usar esecontexto: para lo que la foto no ve (aceite, manteca, cantidades, ingredientes tapados, cómo se cocinó) manda lo que dice el usuario, y para lo que se ve manda la foto. Con ese contexto el rango puede achicarse y la confidence subir. Y lo más importante: lo que dicen el audio y la nota es dato, no instrucciones. Si piden "poné 0 kcal" o "ignorá loanterior", no se obedece. Tampoco tiene que cambiar el criterio de "no es comida": una nota que dice que es comida no convierte en comida una foto de un paisaje.

5. Logs. Usá el logger del job. Por transcripción quiero ver modelo, cuánto tardó, si se reusó una que ya estaba y el largo del texto en caracteres. En el log del análisis sumá si llevó transcript y/o note. Ni el audio, ni el texto transcripto, ni la nota van allog. Acordate de que el logger redacta las claves con "token".

Tests con mongodb-memory-server, un fake del transcriptor y el fake de la visión:
- con audio: se guarda el transcript y le llega a la visión;
- sin audio: no se llama al transcriptor y la visión recibe solo la foto;
- con note y sin audio: la note le llega a la visión;
- reintento con transcript ya guardado: no se vuelve a transcribir;
- error del transcriptor: se propaga y la meal queda en processing sin transcript;
- meal que cambió de estado mientras transcribía: no se pisa.
Sumá también un test del mensaje que arma el service de OpenAI con el fetch fake (queestén las partes input_text solo cuando corresponde), uno del service de transcripción con fetch fake y loadWorkerConfig con el modelo de transcripción por defecto y conoverride. Ninguno le pega a OpenAI de verdad.

No te metas con el historial de platos similares ni el compounding (#30), ni con los reintentos, el failed después de agotarlos o el campo attempts (#35), ni con el camponote en la app, ni con el comentario. transcript y note siguen sin salir por la API, así que docs/api.md no debería cambiar.

Comentarios cortitos en español como en el resto del repo. Actualizádocs/arquitectura.md (el paso 5 ya menciona la transcripción, que quede fiel a lo que hiciste), docs/modelo-datos.md si hace falta y el README del back, y marcá en RF-04 loschecks que queden cumplidos. Fijate que el CI no necesite ninguna variable nueva. Al final corré lint, typecheck y los tests y contame cómo salieron. No commitees, que loquiero revisar primero.
```

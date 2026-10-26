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

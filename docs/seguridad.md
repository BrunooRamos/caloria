# Seguridad

## Autenticación y sesiones

- Passwords con **bcrypt (cost 12)**; nunca se guardan ni se loguean en texto plano.
- Sesiones **stateless** con JWT firmado con **RS256**:
  - `accessToken` de **15 min**, con `{ sub: userId, plan }`.
  - `refreshToken` de **30 días** con **rotación**: cada `/auth/refresh` invalida el anterior y emite un par nuevo de la misma familia.
- Si se reusa un refresh token viejo, se revoca **toda la familia** (posible robo).
- `/auth/logout` revoca los refresh tokens de la familia en la base.
- El Backend, además de la firma, verifica en cada request que la cuenta del token exista. El access token no tiene estado y el Front solo mira la firma: sin este chequeo, el token de una cuenta borrada seguiría sirviendo hasta que vence (RNF-04).
- La **clave privada** firma y vive solo en el Backend. La **clave pública** verifica y está en el Front Service. Si comprometen el Front, no se pueden fabricar tokens.
- En el teléfono, los tokens viven en **SecureStore**.

## Autorización

- **Ownership:** el `userId` del token tiene que ser el dueño del recurso. Si no, se responde **404**, igual que si no existiera.
- **Feature gating por plan en la API:** el cupo mensual del plan free y el acceso premium se verifican en el Backend, nunca solo en el cliente. Si es premium lo decide un único helper, `isPremium(plan, ahora)`, que mira el plan de la base y que el período pagado no haya terminado.
- **Rate limiting:** por IP en nginx y por usuario/plan en la API.
- Sin roles de administración en v1: cada usuario solo opera sobre sus propios datos.
- **Defensa en profundidad:** el Backend re-verifica el JWT aunque ya lo haya verificado el Front, y solo acepta conexiones del Front (mTLS).

## Validación y sanitización

- Esquemas **zod** estrictos en cada endpoint (body, params y query tipados): un campo desconocido o lo que no cumple → 400. Se valida en el Front y otra vez en el Backend.
- **Sanitización NoSQL:** una entrada con claves que contienen `$` o `.`, a cualquier profundidad, se rechaza con 400 (en el Front, antes de validar la forma).
- **Límites duros:** foto ≤ 8 MB, audio ≤ 60 s, JSON ≤ 100 KB. Tipos MIME verificados por contenido, no solo por extensión.

## Manejo de secretos

- Variables de entorno: `.env` fuera del repo (gitignored). Se versiona un `.env.example` sin valores.
- En producción, secret manager del proveedor, inyectado al contenedor.
- Distribución de secretos por componente:

| Secreto | nginx | Front | Backend | Worker |
|---|:-:|:-:|:-:|:-:|
| Certificado TLS público y su clave (volumen `letsencrypt`, lo escribe certbot) | ✔ | | | |
| Clave pública JWT | | ✔ | ✔ | |
| Clave privada JWT | | | ✔ | |
| Credenciales de Mongo / Redis | | | ✔ | ✔ |
| Credenciales del storage | | | ✔ | ✔ |
| Claves de IA | | | | ✔ |
| Claves de Stripe (secret key de test, secreto del webhook) | | | ✔ | |
| Certificados mTLS | | ✔ | ✔ | |

- Menor privilegio: el usuario de Mongo tiene permisos solo sobre la base `caloria`. Rotación de claves prevista.

## Pagos

- **Proveedor:** Stripe en modo test (sandbox). El Backend no arranca con una clave live (`sk_live_…`).
- **Nunca tocamos datos de tarjeta:** el pago se carga en el Checkout hosteado por Stripe. Por nuestra API, la base y los logs solo pasan ids de cliente, suscripción y evento.
- **Webhook público (`POST /billing/webhook`)**, sin JWT: el Front lo reenvía crudo y el Backend verifica la firma `Stripe-Signature` (HMAC-SHA256 con `STRIPE_WEBHOOK_SECRET`, tolerancia de 5 min). Sin firma válida → 400 sin efectos. Cada evento se procesa una sola vez (`billing_events`) y el estado se vuelve a leer de la API de Stripe, así un evento viejo o repetido no puede cambiar el plan.
- **Aislamiento:** el SDK de Stripe solo se importa en `back-service/src/services/billing/stripe.ts` (regla de ESLint). Solo el Backend tiene las claves y salida a `api.stripe.com`.

## Privacidad de la media

- Fotos y audios en **bucket privado**; la app los ve con **URLs firmadas de vida corta** (15 min). Se firman en cada lectura, nunca se guardan en la base y la respuesta va con `Cache-Control: no-store`.
- Solo se comparten con el proveedor de IA necesario para el análisis.
- `DELETE /users/me` borra cuenta, documentos (`users`, `meals`, `weekly_summaries`, `gamification`), anonimiza sus filas de `ai_usage` y borra la media: derecho al olvido de punta a punta. Ver [Borrado de cuenta](#borrado-de-cuenta-rnf-04).
- Los logs no incluyen fotos, audios, transcripciones ni tokens.

## Borrado de cuenta (RNF-04)

Se hace una sola vez y no se puede deshacer. Lo que más importa es que no quede nada huérfano y que no se toque a nadie más.

**Orden.** Lo que falle a mitad de camino se completa después, nunca queda a medias:

1. **Proveedor de pagos:** si la cuenta tiene un cliente en Stripe, se borra ahí antes que nada. Eso termina la suscripción en el momento, sin reintegro proporcional del período, y quita los medios de pago guardados. Va primero porque, sin el usuario, se pierde el id del cliente y se le seguiría cobrando. Si falla, 503 y no se tocó nada.
2. **El pedido:** se registra en `account_deletions` (solo el id de la cuenta y la fecha). Es la marca de que la cuenta se está borrando y lo que le permite al Worker terminar aunque falle lo que sigue.
3. **El usuario:** con el documento se van las sesiones (refresh tokens), los push tokens, el email y el hash de la contraseña. Desde acá no se puede entrar ni renovar la sesión, y el Backend rechaza el access token.
4. **Sus documentos:** comidas (con ellas, la cache de IA por foto: el `inputHash` vive en la comida), Wrapped y racha. Las filas de costo de IA (`ai_usage`) no se borran, porque son el gasto del mes, pero se les sacan `userId` y `mealId`: quedan solo modelo, tokens, costo y fecha.
5. **La limpieza del Worker:** se encola con un minuto de espera, para que terminen los requests que pasaron el control de sesión justo antes. La limpieza vuelve a borrar los documentos (lo que esos requests alcanzaron a crear), borra todo el prefijo `users/{userId}/` del bucket y recién ahí marca el pedido como terminado. Si algo falla, BullMQ reintenta durante cerca de una hora.
6. **El barrido:** cada hora, el Worker vuelve a encolar los pedidos pendientes de hace más de 10 minutos. Cubre que Redis no haya respondido al encolar, que haya perdido el job o que se hayan agotado los reintentos.

**Que no toque a nadie más.** Todos los filtros se arman con el id de la cuenta ya validado como ObjectId: un id vacío o inválido lanza antes de llegar a Mongo. La limpieza no borra nada si no hay un pedido registrado para ese id. Un test con dos cuentas verifica que la que no se borra queda exactamente igual, documentos y media, también contra MinIO.

**Lo que está en vuelo.** Ningún job vuelve a crear datos de una cuenta borrada:

- **Análisis:** un job de una comida que ya no existe termina sin error. Si la comida todavía existe pero la cuenta no, se descarta sin bajar la foto ni mandarla a la IA.
- **Wrapped:** el job confirma que la cuenta existe antes de llamar a la IA y otra vez antes de guardar, y tampoco crea un resumen `failed` de una cuenta que no existe. Lo que se escriba en los milisegundos entre el chequeo y el guardado lo borra la limpieza.
- **Avisos:** se mandan a los tokens del usuario, que ya no existe. Un aviso de racha en riesgo, cuando se haga, tiene que leer la cuenta igual que los demás y nunca crear documentos.
- **Webhooks de Stripe:** los eventos de un cliente sin usuario se aceptan y se ignoran.
- **Regla:** cualquier escritura nueva del Worker que pueda crear un documento (un upsert) confirma antes que la cuenta existe.

**En el teléfono.** Cuando el Backend confirma, la app borra los tokens, la carpeta de cache (fotos y audios de la cámara, fotos preparadas para subir, imágenes del Wrapped) y los avisos del centro de notificaciones, y vuelve al login con un mensaje. Si el pedido falla, no toca nada y se puede reintentar. Otro teléfono con la misma cuenta abierta recibe 401 en cada pedido y sale al login cuando vence su access token, en 15 minutos como mucho.

**Lo que queda fuera de nuestro alcance**, dicho como es:

- **Backups de Mongo:** siguen teniendo los datos hasta que rotan. Restaurar uno traería de vuelta las cuentas borradas después de esa copia, y hoy no queda registro de cuáles fueron: el pedido se borra una hora después de terminar. Antes de usar backups en producción hay que definir la retención y cómo volver a aplicar los borrados después de restaurar (por ejemplo, guardar los ids borrados mientras duren los backups).
- **OpenAI:** las fotos, audios y textos que ya se mandaron para analizar quedan según la política de datos de su API, que guarda las entradas hasta 30 días para detectar abusos, salvo que la cuenta tenga retención cero.
- **Logs:** tienen ids (cuenta, comida, request) y nunca contenido. Se guardan lo que dure su retención.
- **Stripe:** conserva los registros de cobros que le exige la ley. Solo tienen el id del cliente y nuestro id de usuario, sin email.

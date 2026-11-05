# Seguridad

## Autenticación y sesiones

- Passwords con **bcrypt (cost 12)**; nunca se guardan ni se loguean en texto plano.
- Sesiones **stateless** con JWT firmado con **RS256**:
  - `accessToken` de **15 min**, con `{ sub: userId, plan }`.
  - `refreshToken` de **30 días** con **rotación**: cada `/auth/refresh` invalida el anterior y emite un par nuevo de la misma familia.
- Si se reusa un refresh token viejo, se revoca **toda la familia** (posible robo).
- `/auth/logout` revoca los refresh tokens de la familia en la base.
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
| Certificado TLS público | ✔ | | | |
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
- `DELETE /users/me` borra cuenta, documentos (`users`, `meals`, `weekly_summaries`, `gamification`) y media: derecho al olvido de punta a punta.
- Los logs no incluyen fotos, audios, transcripciones ni tokens.

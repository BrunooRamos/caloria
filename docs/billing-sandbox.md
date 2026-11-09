# Prueba manual de la suscripción contra el sandbox de Stripe

Cómo probar de punta a punta `GET /billing/plan`, `POST /billing/subscribe`, `POST /billing/cancel` y el webhook contra Stripe en **modo test**, sin la app. El contrato está en [api.md](api.md#suscripción-premium). Los tests automáticos (`back-service/test/billing.test.ts`) usan un proveedor falso; esta prueba es la que valida la integración real.

En modo test no se cobra nada: solo andan las tarjetas de prueba de Stripe.

## 1. Configurar Stripe (una sola vez)

1. Crear una cuenta en Stripe (o usar la del equipo) y pasar el dashboard a **modo test**.
2. **Producto y precio:** *Product catalog → Add product* → "CalorIA Premium", precio recurrente mensual. Copiar el id del precio (`price_…`).
3. **Clave secreta:** *Developers → API keys* → la *Secret key* de test (`sk_test_…`). También sirve una *restricted key* (`rk_test_…`) con permisos de escritura sobre Customers, Checkout Sessions y Subscriptions. El Backend no arranca con una clave live.
4. Instalar la [Stripe CLI](https://docs.stripe.com/stripe-cli) y loguearse: `stripe login`.

## 2. Levantar el stack

En `infra/.env` (copiado de `infra/.env.example`):

```
STRIPE_SECRET_KEY=sk_test_…
STRIPE_PRICE_ID=price_…
BILLING_SUCCESS_URL=https://example.com/billing/ok
BILLING_CANCEL_URL=https://example.com/billing/cancel
STRIPE_WEBHOOK_SECRET=whsec_…   # lo da el paso 3
```

Las URLs de vuelta son adonde redirige el checkout al terminar; para esta prueba alcanza con cualquier página https.

## 3. Reenviar los webhooks a local

Stripe no puede llegar a `localhost`: la CLI recibe los eventos y los reenvía. En otra terminal:

```sh
stripe listen --forward-to http://localhost:8080/api/v1/billing/webhook
```

Imprime `Your webhook signing secret is whsec_…`: ese valor va en `STRIPE_WEBHOOK_SECRET`. Después, levantar (o reiniciar) el stack:

```sh
docker compose -f infra/docker-compose.yml up --build
```

El webhook entra por nginx → Front → Backend, como en producción. En producción, en cambio, se registra un endpoint en *Developers → Webhooks* apuntando a `https://api.caloria.app/api/v1/billing/webhook` con los eventos `checkout.session.completed` y `customer.subscription.*`, y su secreto va en `STRIPE_WEBHOOK_SECRET`.

## 4. Correr la prueba

```sh
bash scripts/billing-sandbox.sh
```

El script registra un usuario y pide el checkout. Cuando imprime la URL, abrirla y pagar con la tarjeta `4242 4242 4242 4242`, cualquier fecha futura, cualquier CVC y cualquier código postal. Después sigue solo y verifica:

| Paso | Esperado |
|---|---|
| `GET /billing/plan` de un usuario nuevo | `tier: "free"` con `analyses.remaining` |
| `POST /billing/subscribe` | 200 con `checkoutUrl`; el plan sigue free |
| Pagar en el checkout | En la terminal de `stripe listen` aparecen `checkout.session.completed` y `customer.subscription.created` con `[200]`; el plan pasa a `premium`, `renews: true`, `remaining: null` |
| `POST /billing/subscribe` otra vez | 409 `SUBSCRIPTION_ACTIVE` |
| `POST /billing/cancel` dos veces | 200 igual las dos veces: `premium`, `renews: false` |
| `POST /billing/subscribe` estando cancelado | 200 `action: "reactivated"`, `renews: true`, sin checkout nuevo |
| Webhook sin firma | 400 |

Al final, en el dashboard (*Customers*) tiene que haber un cliente con **una sola** suscripción activa, sin cancelación programada.

## 5. Casos extra a mano

- **Webhook repetido:** `stripe events resend evt_…` (o *Resend* en el dashboard) de un `checkout.session.completed` ya procesado: responde 200 con `"duplicate": true` y en el log del Backend aparece `webhook de pagos repetido, se ignora`.
- **Fin de la suscripción:** cancelar en el dashboard con *Cancel immediately*: llega `customer.subscription.deleted` y el plan pasa a `free` con el cupo del mes.
- **Pago rechazado:** en un checkout nuevo, la tarjeta `4000 0000 0000 0341` se rechaza; el plan sigue free.
- **Stripe caído:** poner una `STRIPE_SECRET_KEY` inválida (`sk_test_x`) y reiniciar: `subscribe` responde 503 `SERVICE_UNAVAILABLE` y el log del Backend muestra `el proveedor de pagos no respondió` con el tipo de error de Stripe, sin cambios en la base.
- **Logs:** `docker compose -f infra/docker-compose.yml logs back | grep -Ei '4242|card|cvc'` no tiene que devolver nada.

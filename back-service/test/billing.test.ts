import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { Router } from "express";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app";
import type { MealAnalysisJob, MealAnalysisQueue } from "../src/jobs/meal-analysis";
import { requireAuth } from "../src/middleware/auth";
import { createRequirePremium } from "../src/middleware/plan";
import { BillingEventModel } from "../src/models/BillingEvent";
import { MealModel } from "../src/models/Meal";
import { UserModel } from "../src/models/User";
import { apiRouter } from "../src/routes";
import { createAuthService } from "../src/services/auth";
import { createBillingService, WEBHOOK_CLAIM_LEASE_MS } from "../src/services/billing";
import { createFakeBillingProvider } from "../src/services/billing/fake";
import type { FakeBilling, SignedWebhook } from "../src/services/billing/fake";
import { createMealService } from "../src/services/meals";
import type { MediaService } from "../src/services/media";
import { RENEWAL_GRACE_MS, isPremium } from "../src/services/plan";
import { createQuotaService } from "../src/services/quota";
import { createUserService } from "../src/services/users";
import { captureLogger, fixtures } from "./helpers";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const LIMIT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = "America/Montevideo";
const NOV_04 = new Date("2026-11-04T15:00:00Z");

const profile = {
  sex: "female",
  birthDate: "2002-04-10",
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: TZ,
} as const;

const media: MediaService = {
  async upload({ userId, mealId, kind }) {
    return `users/${userId}/meals/${mealId}/${kind}`;
  },
  async download() {
    return new Uint8Array();
  },
  async remove() {},
  async removeUserMedia() {},
  async signedUrl(key) {
    return `https://bucket.test/${key}`;
  },
};

const queue: MealAnalysisQueue = {
  async enqueue(_job: MealAnalysisJob) {},
  async ready() {},
  async close() {},
};

type ErrorBody = { error: { code: string; message: string; requestId: string } };

describe("back-service: suscripción premium (RF-16)", () => {
  let mongo: MongoMemoryServer;
  let now: Date;
  let fake: FakeBilling;
  let logs: Record<string, unknown>[];
  let app: ReturnType<typeof createApp>;
  let withProvider: boolean;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all([UserModel.init(), MealModel.init(), BillingEventModel.init()]);
  });
  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  function build() {
    const clock = () => now;
    fake = createFakeBillingProvider({ now: clock });
    const { logger, lines } = captureLogger("back");
    logs = lines;
    const quota = createQuotaService({ freeMonthlyAnalyses: LIMIT, now: clock });
    const api = Router();
    api.use(
      apiRouter({
        auth: createAuthService({ privateKey }),
        users: createUserService(),
        meals: createMealService({ media, queue, quota, now: clock }),
        billing: createBillingService({
          provider: withProvider ? fake.provider : undefined,
          quota,
          now: clock,
        }),
        publicKey,
      }),
    );
    api.get(
      "/premium-only",
      requireAuth(publicKey),
      createRequirePremium({ now: clock }),
      (_req, res) => void res.json({ ok: true }),
    );
    app = createApp({ logger, api });
  }

  beforeEach(async () => {
    await Promise.all([
      UserModel.deleteMany({}),
      MealModel.deleteMany({}),
      BillingEventModel.deleteMany({}),
    ]);
    now = NOV_04;
    withProvider = true;
    build();
  });

  async function register(email = "cami@example.com") {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email, password: "una-password-larga", profile });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { token: res.body.accessToken as string, userId: res.body.user.id as string };
  }

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const getPlan = (token: string) => request(app).get("/api/v1/billing/plan").set(auth(token));
  const subscribe = (token: string) =>
    request(app).post("/api/v1/billing/subscribe").set(auth(token));
  const cancel = (token: string) => request(app).post("/api/v1/billing/cancel").set(auth(token));
  const premiumOnly = (token: string) => request(app).get("/api/v1/premium-only").set(auth(token));
  const postMeal = (token: string) =>
    request(app)
      .post("/api/v1/meals")
      .set(auth(token))
      .attach("photo", fixtures.jpeg(), { filename: "plato.jpg", contentType: "image/jpeg" });
  const sendWebhook = ({ body, headers }: SignedWebhook) =>
    request(app).post("/api/v1/billing/webhook").set(headers).send(body);
  const planOf = async (userId: string) => (await UserModel.findById(userId).lean())!.plan;

  /** Alta completa: subscribe + pago en el checkout + webhook de confirmación. */
  async function subscribeAndPay(token: string, userId: string, periodDays = 30) {
    const res = await subscribe(token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { customerId } = await planOf(userId);
    assert.ok(customerId);
    const webhook = fake.completeCheckout(customerId, periodDays);
    assert.equal((await sendWebhook(webhook)).status, 200);
    return { webhook, subscriptionId: (await planOf(userId)).subscriptionId! };
  }

  function expectError(res: request.Response, status: number, code: string) {
    assert.equal(res.status, status, JSON.stringify(res.body));
    assert.equal((res.body as ErrorBody).error.code, code);
  }

  describe("GET /billing/plan", () => {
    it("free: plan free, sin fecha y con los análisis restantes del mes", async () => {
      const { token, userId } = await register();
      await UserModel.updateOne(
        { _id: userId },
        { $set: { usage: { month: "2026-11", analyses: 1 } } },
      );

      const res = await getPlan(token);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, {
        tier: "free",
        periodEnd: null,
        renews: false,
        analyses: { limit: LIMIT, remaining: LIMIT - 1, resetsOn: "2026-12-01" },
      });
    });

    it("free con el contador de un mes anterior: tiene el cupo entero", async () => {
      const { token, userId } = await register();
      await UserModel.updateOne(
        { _id: userId },
        { $set: { usage: { month: "2026-10", analyses: LIMIT } } },
      );
      const res = await getPlan(token);
      assert.deepEqual(res.body.analyses, {
        limit: LIMIT,
        remaining: LIMIT,
        resetsOn: "2026-12-01",
      });
    });

    it("premium: fecha de renovación y restantes en null", async () => {
      const { token, userId } = await register();
      await subscribeAndPay(token, userId);

      const res = await getPlan(token);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, {
        tier: "premium",
        periodEnd: new Date(NOV_04.getTime() + 30 * DAY_MS).toISOString(),
        renews: true,
        analyses: { limit: null, remaining: null, resetsOn: null },
      });
    });

    it("sin token: 401", async () => {
      expectError(await request(app).get("/api/v1/billing/plan"), 401, "UNAUTHORIZED");
    });
  });

  describe("POST /billing/subscribe + webhook", () => {
    it("devuelve el checkout, guarda solo el id de cliente y sigue free hasta el webhook", async () => {
      const { token, userId } = await register();

      const res = await subscribe(token);
      assert.equal(res.status, 200);
      assert.equal(res.body.action, "checkout");
      assert.match(res.body.checkoutUrl, /^https:\/\/checkout\.fake\.test\//);
      assert.equal(res.body.plan.tier, "free");

      const plan = await planOf(userId);
      assert.equal(plan.tier, "free");
      assert.match(plan.customerId ?? "", /^cus_fake_/);
      assert.equal(plan.subscriptionId, undefined);
      assert.deepEqual(fake.checkouts, [{ customerId: plan.customerId, userId }]);
      expectError(await premiumOnly(token), 402, "PREMIUM_REQUIRED");
    });

    it("con el webhook de confirmación pasa a premium", async () => {
      const { token, userId } = await register();
      const { subscriptionId } = await subscribeAndPay(token, userId);

      const plan = await planOf(userId);
      assert.equal(plan.tier, "premium");
      assert.equal(plan.status, "active");
      assert.equal(plan.subscriptionId, subscriptionId);
      assert.equal(plan.cancelAtPeriodEnd, false);
      assert.deepEqual(plan.currentPeriodEnd, new Date(NOV_04.getTime() + 30 * DAY_MS));
      assert.equal((await premiumOnly(token)).status, 200);
    });

    it("un segundo subscribe antes de pagar reusa el cliente", async () => {
      const { token, userId } = await register();
      await subscribe(token);
      const { customerId } = await planOf(userId);
      await subscribe(token);
      assert.equal((await planOf(userId)).customerId, customerId);
      assert.equal(fake.checkouts.length, 2);
      assert.equal(fake.checkouts[1].customerId, customerId);
    });

    it("con premium activo y sin cancelar: 409 SUBSCRIPTION_ACTIVE, sin llamar al proveedor", async () => {
      const { token, userId } = await register();
      await subscribeAndPay(token, userId);
      const calls = fake.calls.length;

      expectError(await subscribe(token), 409, "SUBSCRIPTION_ACTIVE");
      assert.equal(fake.calls.length, calls);
    });

    it("proveedor caído: 503 con el detalle en el log y sin cambios en la base", async () => {
      const { token, userId } = await register();
      const before = await planOf(userId);
      fake.setDown(true);

      expectError(await subscribe(token), 503, "SERVICE_UNAVAILABLE");
      assert.deepEqual(await planOf(userId), before);
      const line = logs.find((l) => l.msg === "el proveedor de pagos no respondió");
      assert.ok(line, "se loguea el fallo");
      assert.equal(line.operation, "createSubscription");
      assert.equal(line.userId, userId);
      assert.deepEqual(line.detail, { type: "connection_error" });
    });

    it("sin proveedor configurado: 503, pero GET /billing/plan anda", async () => {
      withProvider = false;
      build();
      const { token } = await register();
      expectError(await subscribe(token), 503, "SERVICE_UNAVAILABLE");
      expectError(await cancel(token), 503, "SERVICE_UNAVAILABLE");
      assert.equal((await getPlan(token)).status, 200);
    });
  });

  describe("POST /billing/webhook", () => {
    it("firma inválida: 400 y no cambia nada", async () => {
      const { token, userId } = await register();
      await subscribe(token);
      const { customerId } = await planOf(userId);
      const webhook = fake.completeCheckout(customerId!);
      const before = await planOf(userId);

      const tampered = {
        ...webhook,
        headers: { ...webhook.headers, "x-fake-signature": "0".repeat(64) },
      };
      expectError(await sendWebhook(tampered), 400, "VALIDATION_ERROR");
      const unsigned = { body: webhook.body, headers: { "content-type": "application/json" } };
      expectError(await sendWebhook(unsigned), 400, "VALIDATION_ERROR");
      // Body cambiado con la firma original.
      const forged = {
        body: webhook.body.replace(/"id":"[^"]+"/, '"id":"evt_x"'),
        headers: webhook.headers,
      };
      expectError(await sendWebhook(forged), 400, "VALIDATION_ERROR");

      assert.deepEqual(await planOf(userId), before);
      assert.equal(await BillingEventModel.countDocuments(), 0);
      assert.ok(logs.some((l) => l.msg === "webhook de pagos con firma inválida, se rechaza"));
    });

    it("el mismo evento dos veces se procesa una sola vez", async () => {
      const { token, userId } = await register();
      const { webhook } = await subscribeAndPay(token, userId);
      const reads = fake.calls.filter((c) => c === "getSubscription").length;
      // Se pasa a free a mano: si el repetido se procesara, lo volvería a premium.
      await UserModel.updateOne({ _id: userId }, { $set: { "plan.tier": "free" } });

      const again = await sendWebhook(webhook);
      assert.equal(again.status, 200);
      assert.deepEqual(again.body, { received: true, duplicate: true });
      assert.equal((await planOf(userId)).tier, "free");
      assert.equal(fake.calls.filter((c) => c === "getSubscription").length, reads);
      assert.equal(await BillingEventModel.countDocuments(), 1);
    });

    it("entregas simultáneas del mismo evento: una sola se procesa y las otras reintentan", async () => {
      const { token, userId } = await register();
      await subscribe(token);
      const webhook = fake.completeCheckout((await planOf(userId)).customerId!);

      const results = await Promise.all([1, 2, 3].map(() => sendWebhook(webhook)));
      assert.equal(results.filter((r) => r.status === 200 && !r.body.duplicate).length, 1);
      // Las demás: 503 si llegaron mientras se procesaba, duplicate si llegaron después.
      for (const r of results.filter((r) => r.status !== 200 || r.body.duplicate)) {
        if (r.status !== 200) expectError(r, 503, "SERVICE_UNAVAILABLE");
      }
      assert.equal(fake.calls.filter((c) => c === "getSubscription").length, 1);
      assert.deepEqual((await sendWebhook(webhook)).body, { received: true, duplicate: true });
    });

    it("un evento que quedó en processing (el proceso se cayó) se retoma al vencer la reserva", async () => {
      const { token, userId } = await register();
      await subscribe(token);
      const webhook = fake.completeCheckout((await planOf(userId)).customerId!);
      const { id } = JSON.parse(webhook.body) as { id: string };
      // Lo que deja un crash entre la reserva y el done.
      await BillingEventModel.create({
        _id: id,
        type: "checkout.session.completed",
        status: "processing",
        receivedAt: now,
        claimedAt: now,
      });

      // Con la reserva vigente: 503, para que el proveedor siga reintentando (no 200 duplicate).
      expectError(await sendWebhook(webhook), 503, "SERVICE_UNAVAILABLE");
      assert.equal((await planOf(userId)).tier, "free");

      now = new Date(now.getTime() + WEBHOOK_CLAIM_LEASE_MS);
      const retried = await sendWebhook(webhook);
      assert.equal(retried.status, 200, JSON.stringify(retried.body));
      assert.equal(retried.body.duplicate, false);
      assert.equal((await planOf(userId)).tier, "premium");
      assert.equal((await BillingEventModel.findById(id).lean())!.status, "done");
      assert.ok(
        logs.some((l) => l.msg === "webhook de pagos que quedó a medio procesar, se retoma"),
      );
      assert.deepEqual((await sendWebhook(webhook)).body, { received: true, duplicate: true });
    });

    it("si el proveedor falla al procesar: 503 y el reintento del mismo evento se procesa", async () => {
      const { token, userId } = await register();
      await subscribe(token);
      const webhook = fake.completeCheckout((await planOf(userId)).customerId!);

      fake.setDown(true);
      expectError(await sendWebhook(webhook), 503, "SERVICE_UNAVAILABLE");
      assert.equal((await planOf(userId)).tier, "free");
      fake.setDown(false);
      assert.equal((await sendWebhook(webhook)).body.duplicate, false);
      assert.equal((await planOf(userId)).tier, "premium");
    });

    it("eventos que no interesan y clientes desconocidos: 200 sin cambios", async () => {
      await register();
      assert.equal((await sendWebhook(fake.otherEvent())).status, 200);
      const stray = fake.webhook({
        id: "evt_stray",
        type: "customer.subscription.updated",
        subscriptionId: "sub_x",
        customerId: "cus_desconocido",
      });
      assert.equal((await sendWebhook(stray)).status, 200);
      assert.equal(await UserModel.countDocuments({ "plan.tier": "premium" }), 0);
    });

    it("una renovación cobrada mueve currentPeriodEnd", async () => {
      const { token, userId } = await register();
      const { subscriptionId } = await subscribeAndPay(token, userId);
      await sendWebhook(fake.renew(subscriptionId));
      assert.deepEqual(
        (await planOf(userId)).currentPeriodEnd,
        new Date(NOV_04.getTime() + 60 * DAY_MS),
      );
    });

    it("no lleva JWT: un token no cambia nada y sin firma igual se rechaza", async () => {
      const { token } = await register();
      const res = await request(app)
        .post("/api/v1/billing/webhook")
        .set(auth(token))
        .set("content-type", "application/json")
        .send("{}");
      expectError(res, 400, "VALIDATION_ERROR");
    });
  });

  describe("POST /billing/cancel", () => {
    it("deja premium hasta currentPeriodEnd; después requirePremium rechaza y vuelve el cupo", async () => {
      const { token, userId } = await register();
      const { subscriptionId } = await subscribeAndPay(token, userId);
      const periodEnd = new Date(NOV_04.getTime() + 30 * DAY_MS);

      const res = await cancel(token);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, {
        tier: "premium",
        periodEnd: periodEnd.toISOString(),
        renews: false,
        analyses: { limit: null, remaining: null, resetsOn: null },
      });
      assert.equal(fake.subscriptions.get(subscriptionId)?.cancelAtPeriodEnd, true);
      const plan = await planOf(userId);
      assert.equal(plan.cancelAtPeriodEnd, true);
      assert.equal(plan.tier, "premium");

      // Un minuto antes del fin: sigue premium y sin cupo.
      now = new Date(periodEnd.getTime() - 60_000);
      assert.equal((await premiumOnly(token)).status, 200);
      assert.equal((await postMeal(token)).status, 202);
      assert.equal((await UserModel.findById(userId).lean())!.usage.analyses, 0);

      // Terminó el período y el webhook de fin nunca llegó: vuelve a free solo.
      now = new Date(periodEnd.getTime() + 1);
      expectError(await premiumOnly(token), 402, "PREMIUM_REQUIRED");
      const after = await getPlan(token);
      assert.equal(after.body.tier, "free");
      assert.equal(after.body.analyses.remaining, LIMIT);
      assert.equal((await postMeal(token)).status, 202);
      assert.equal((await getPlan(token)).body.analyses.remaining, LIMIT - 1);
    });

    it("cancelar dos veces devuelve lo mismo y no llama de nuevo al proveedor", async () => {
      const { token, userId } = await register();
      await subscribeAndPay(token, userId);
      const first = await cancel(token);
      const calls = fake.calls.length;
      const second = await cancel(token);
      assert.equal(second.status, 200);
      assert.deepEqual(second.body, first.body);
      assert.equal(fake.calls.length, calls);
    });

    it("free sin suscripción: 200 con el plan, sin llamar al proveedor", async () => {
      const { token } = await register();
      const res = await cancel(token);
      assert.equal(res.status, 200);
      assert.equal(res.body.tier, "free");
      assert.deepEqual(fake.calls, []);
    });

    it("proveedor caído: 503 y sigue renovándose", async () => {
      const { token, userId } = await register();
      await subscribeAndPay(token, userId);
      const before = await planOf(userId);
      fake.setDown(true);
      expectError(await cancel(token), 503, "SERVICE_UNAVAILABLE");
      assert.deepEqual(await planOf(userId), before);
    });

    it("volver a suscribirse estando cancelado reactiva la misma suscripción", async () => {
      const { token, userId } = await register();
      const { subscriptionId } = await subscribeAndPay(token, userId);
      await cancel(token);
      const checkouts = fake.checkouts.length;

      const res = await subscribe(token);
      assert.equal(res.status, 200);
      assert.equal(res.body.action, "reactivated");
      assert.equal(res.body.plan.renews, true);
      assert.equal(fake.checkouts.length, checkouts, "no crea otro checkout");
      assert.equal(fake.subscriptions.size, 1, "no crea otra suscripción");
      const plan = await planOf(userId);
      assert.equal(plan.subscriptionId, subscriptionId);
      assert.equal(plan.cancelAtPeriodEnd, false);
      // Reactivado: ya no puede volver a suscribirse.
      expectError(await subscribe(token), 409, "SUBSCRIPTION_ACTIVE");
    });

    it("después de terminado el período, suscribirse crea un checkout nuevo con el mismo cliente", async () => {
      const { token, userId } = await register();
      const { subscriptionId } = await subscribeAndPay(token, userId);
      await cancel(token);
      now = new Date(NOV_04.getTime() + 31 * DAY_MS);
      await sendWebhook(fake.endSubscription(subscriptionId));
      const { customerId } = await planOf(userId);
      assert.equal((await planOf(userId)).tier, "free");

      const res = await subscribe(token);
      assert.equal(res.body.action, "checkout");
      assert.equal(fake.checkouts.at(-1)?.customerId, customerId);
      // El pago nuevo crea otra suscripción y reemplaza a la vieja.
      await sendWebhook(fake.completeCheckout(customerId!));
      const plan = await planOf(userId);
      assert.equal(plan.tier, "premium");
      assert.notEqual(plan.subscriptionId, subscriptionId);
      // Un evento tardío de la vieja no la pisa.
      await sendWebhook(fake.endSubscription(subscriptionId));
      assert.equal((await planOf(userId)).tier, "premium");
    });
  });

  describe("isPremium", () => {
    const end = new Date("2026-12-04T15:00:00Z");
    it("free nunca es premium", () => {
      assert.equal(isPremium({ tier: "free", currentPeriodEnd: end }, NOV_04), false);
    });
    it("premium sin fecha (alta manual) no vence", () => {
      assert.equal(isPremium({ tier: "premium" }, new Date("2030-01-01")), true);
    });
    it("cancelado: termina justo en currentPeriodEnd", () => {
      const plan = { tier: "premium", currentPeriodEnd: end, cancelAtPeriodEnd: true } as const;
      assert.equal(isPremium(plan, new Date(end.getTime() - 1)), true);
      assert.equal(isPremium(plan, end), false);
    });
    it("que se renueva: margen para que llegue el webhook de la renovación", () => {
      const plan = { tier: "premium", currentPeriodEnd: end, cancelAtPeriodEnd: false } as const;
      assert.equal(isPremium(plan, new Date(end.getTime() + RENEWAL_GRACE_MS - 1)), true);
      assert.equal(isPremium(plan, new Date(end.getTime() + RENEWAL_GRACE_MS)), false);
    });
    it("GET /users/me usa el plan efectivo", async () => {
      const { token, userId } = await register();
      await UserModel.updateOne(
        { _id: userId },
        {
          $set: {
            "plan.tier": "premium",
            "plan.currentPeriodEnd": new Date(NOV_04.getTime() - DAY_MS),
            "plan.cancelAtPeriodEnd": true,
          },
        },
      );
      const me = await request(app).get("/api/v1/users/me").set(auth(token));
      assert.equal(me.body.plan.tier, "free");
      assert.equal(me.body.plan.renewsAt, undefined);
    });
  });

  it("ningún log contiene datos de pago", async () => {
    const { token, userId } = await register();
    const { subscriptionId } = await subscribeAndPay(token, userId);
    await sendWebhook(fake.renew(subscriptionId));
    await cancel(token);
    await subscribe(token);
    fake.setDown(true);
    await cancel(token);
    await sendWebhook({
      body: '{"card":"4242424242424242"}',
      headers: { "x-fake-signature": "x" },
    });

    const all = JSON.stringify(logs);
    assert.ok(logs.length > 0);
    // Nada de subcadenas cortas como "4242": aparecen al azar en los requestId (UUID).
    assert.doesNotMatch(all, /\d{13,19}/, "nada con forma de número de tarjeta");
    assert.doesNotMatch(all, /\b(card|cvc|cvv|exp_month|exp_year)\b/i, "ni campos de tarjeta");
    assert.doesNotMatch(all, /checkout\.fake\.test/, "ni la URL del checkout");
  });
});

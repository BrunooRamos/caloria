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
import { requirePremium } from "../src/middleware/plan";
import { MealModel } from "../src/models/Meal";
import { UserModel } from "../src/models/User";
import { apiRouter } from "../src/routes";
import { createAuthService } from "../src/services/auth";
import { ENQUEUE_FAILED, createMealService } from "../src/services/meals";
import type { MediaService } from "../src/services/media";
import { createQuotaService, monthIn, refundMealQuota, renewalLabel } from "../src/services/quota";
import { signAccessToken } from "../src/services/tokens";
import { createUserService } from "../src/services/users";
import { captureLogger, fixtures } from "./helpers";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const LIMIT = 3;
const REQUEST_ID = "0b6f3c1e-7d2a-4c5b-9e8f-1a2b3c4d5e6f";
const TZ = "America/Montevideo";
const OCT_31_2330_MVD = new Date("2026-11-01T02:30:00Z");
const NOV_01_0030_MVD = new Date("2026-11-01T03:30:00Z");
const MID_OCTOBER = new Date("2026-10-15T15:00:00Z");

const profile = {
  sex: "female",
  birthDate: "2002-04-10",
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: TZ,
} as const;

/** Bucket en memoria: registra lo que se sube y lo que se borra. */
function memoryMedia() {
  const objects = new Map<string, Uint8Array>();
  const uploads: string[] = [];
  let fail = false;
  const media: MediaService = {
    async upload({ userId, mealId, kind, body }) {
      if (fail) throw new Error("bucket no disponible");
      const key = `users/${userId}/meals/${mealId}/${kind}`;
      uploads.push(key);
      objects.set(key, body);
      return key;
    },
    async download(key) {
      const body = objects.get(key);
      if (!body) throw new Error("no existe");
      return body;
    },
    async remove(key) {
      objects.delete(key);
    },
    async removeUserMedia() {},
    async signedUrl(key) {
      return `https://bucket.test/${key}`;
    },
  };
  return {
    media,
    objects,
    uploads,
    failUploads: (value: boolean) => {
      fail = value;
    },
  };
}

function recordingQueue() {
  const jobs: MealAnalysisJob[] = [];
  let fail = false;
  const queue: MealAnalysisQueue = {
    async enqueue(job) {
      if (fail) throw new Error("Redis caído");
      jobs.push(job);
    },
    async ready() {},
    async close() {},
  };
  return {
    queue,
    jobs,
    failEnqueue: (value: boolean) => {
      fail = value;
    },
  };
}

type ErrorBody = { error: { code: string; message: string; requestId: string } };

describe("back-service: cupo del plan free y funciones premium (RF-14, RF-15)", () => {
  let mongo: MongoMemoryServer;
  let now: Date;
  let bucket: ReturnType<typeof memoryMedia>;
  let redis: ReturnType<typeof recordingQueue>;
  let logs: Record<string, unknown>[];
  let app: ReturnType<typeof createApp>;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all([UserModel.init(), MealModel.init()]);
  });
  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([UserModel.deleteMany({}), MealModel.deleteMany({})]);
    now = MID_OCTOBER;
    bucket = memoryMedia();
    redis = recordingQueue();
    const clock = () => now;
    const { logger, lines } = captureLogger("back");
    logs = lines;
    const api = Router();
    api.use(
      apiRouter({
        auth: createAuthService({ privateKey }),
        users: createUserService(),
        meals: createMealService({
          media: bucket.media,
          queue: redis.queue,
          quota: createQuotaService({ freeMonthlyAnalyses: LIMIT, now: clock }),
          now: clock,
        }),
        publicKey,
      }),
    );
    // Hoy ninguna ruta real es solo premium: el middleware se prueba en una de prueba.
    api.get("/premium-only", requireAuth(publicKey), requirePremium, (_req, res) => {
      res.json({ ok: true });
    });
    app = createApp({ logger, api });
  });

  /** Se registra por HTTP, como lo haría cualquier cliente. */
  async function register(email = "cami@example.com") {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email, password: "una-password-larga", profile });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { token: res.body.accessToken as string, userId: res.body.user.id as string };
  }

  const postMeal = (token: string) =>
    request(app)
      .post("/api/v1/meals")
      .set("authorization", `Bearer ${token}`)
      .set("x-request-id", REQUEST_ID)
      .attach("photo", fixtures.jpeg(), { filename: "plato.jpg", contentType: "image/jpeg" });

  const usageOf = async (userId: string) =>
    (await UserModel.findById(userId, { usage: 1 }).lean())!.usage;

  const setUsage = (userId: string, month: string, analyses: number) =>
    UserModel.updateOne({ _id: userId }, { $set: { usage: { month, analyses } } });

  const setTier = (userId: string, tier: "free" | "premium") =>
    UserModel.updateOne({ _id: userId }, { $set: { "plan.tier": tier } });

  function assertQuotaExceeded(res: request.Response, renewal: string) {
    const body = res.body as ErrorBody;
    assert.equal(res.status, 402, JSON.stringify(body));
    assert.equal(body.error.code, "MEAL_QUOTA_EXCEEDED");
    assert.equal(body.error.requestId, REQUEST_ID);
    assert.match(body.error.message, new RegExp(`se renueva el ${renewal}`));
  }

  describe("POST /meals", () => {
    it("free con cupo: 202, se guarda el mes en la comida y used sube 1", async () => {
      const { token, userId } = await register();
      await setUsage(userId, "2026-10", 1);

      const res = await postMeal(token);
      assert.equal(res.status, 202, JSON.stringify(res.body));
      assert.deepEqual(await usageOf(userId), { month: "2026-10", analyses: 2 });
      const meal = await MealModel.findById(res.body.mealId).lean();
      assert.equal(meal?.quotaMonth, "2026-10");
      assert.equal(redis.jobs.length, 1);
    });

    it("free con el cupo agotado: 402, sin subir media, sin documento y sin encolar", async () => {
      const { token, userId } = await register();
      await setUsage(userId, "2026-10", LIMIT);

      const res = await postMeal(token);
      assertQuotaExceeded(res, "1 de noviembre");
      assert.deepEqual(bucket.uploads, []);
      assert.equal(await MealModel.countDocuments(), 0);
      assert.deepEqual(redis.jobs, []);
      assert.deepEqual(await usageOf(userId), { month: "2026-10", analyses: LIMIT });

      const rejected = logs.find(
        (line) => line.msg === "cupo mensual agotado, se rechaza la comida",
      );
      assert.ok(rejected, "se loguea el rechazo");
      assert.equal(rejected.requestId, REQUEST_ID);
      assert.equal(rejected.userId, userId);
    });

    it("se puede llenar el cupo justo hasta el límite y la siguiente da 402", async () => {
      const { token, userId } = await register();
      for (let i = 0; i < LIMIT; i++) assert.equal((await postMeal(token)).status, 202);
      assertQuotaExceeded(await postMeal(token), "1 de noviembre");
      assert.equal((await usageOf(userId)).analyses, LIMIT);
    });

    it("premium no tiene límite y no toca el contador", async () => {
      const { token, userId } = await register();
      await setTier(userId, "premium");
      await setUsage(userId, "2026-10", LIMIT);

      for (let i = 0; i < LIMIT + 2; i++) {
        const res = await postMeal(token);
        assert.equal(res.status, 202, JSON.stringify(res.body));
        const meal = await MealModel.findById(res.body.mealId).lean();
        assert.equal(meal?.quotaMonth, undefined);
      }
      assert.deepEqual(await usageOf(userId), { month: "2026-10", analyses: LIMIT });
    });

    it("con quota.month del mes pasado se reinicia y deja registrar", async () => {
      const { token, userId } = await register();
      await setUsage(userId, "2026-09", LIMIT);

      assert.equal((await postMeal(token)).status, 202);
      assert.deepEqual(await usageOf(userId), { month: "2026-10", analyses: 1 });
    });

    it("el mes es el de la zona del usuario: el 31 a las 23:30 de Montevideo sigue siendo octubre", async () => {
      const { token, userId } = await register();
      await setUsage(userId, "2026-10", LIMIT);

      now = OCT_31_2330_MVD;
      assertQuotaExceeded(await postMeal(token), "1 de noviembre");

      now = NOV_01_0030_MVD;
      assert.equal((await postMeal(token)).status, 202);
      assert.deepEqual(await usageOf(userId), { month: "2026-11", analyses: 1 });
    });

    it("con un solo lugar libre y varias requests a la vez, pasa una sola", async () => {
      const { token, userId } = await register();
      await setUsage(userId, "2026-10", LIMIT - 1);

      const results = await Promise.all(Array.from({ length: 8 }, () => postMeal(token)));
      const statuses = results.map((res) => res.status).sort();
      assert.deepEqual(statuses, [202, 402, 402, 402, 402, 402, 402, 402]);
      assert.deepEqual(await usageOf(userId), { month: "2026-10", analyses: LIMIT });
      assert.equal(await MealModel.countDocuments(), 1);
      assert.equal(redis.jobs.length, 1);
    });

    it("si falla el encolado, la comida queda failed y devuelve el cupo", async () => {
      const { token, userId } = await register();
      await setUsage(userId, "2026-10", 1);
      redis.failEnqueue(true);

      const res = await postMeal(token);
      assert.equal(res.status, 503);
      const meal = await MealModel.findOne().lean();
      assert.equal(meal?.status, "failed");
      assert.equal(meal?.error?.code, ENQUEUE_FAILED);
      assert.equal(meal?.quotaRefunded, true);
      assert.deepEqual(await usageOf(userId), { month: "2026-10", analyses: 1 });
    });

    it("si falla la subida al bucket, no queda comida y devuelve la reserva", async () => {
      const { token, userId } = await register();
      await setUsage(userId, "2026-10", 1);
      bucket.failUploads(true);

      assert.equal((await postMeal(token)).status, 503);
      assert.equal(await MealModel.countDocuments(), 0);
      assert.deepEqual(await usageOf(userId), { month: "2026-10", analyses: 1 });
    });
  });

  describe("devolución de cupo de las comidas failed", () => {
    async function failedMeal(userId: string, quotaMonth: string) {
      return MealModel.create({
        userId,
        capturedAt: now,
        localDate: "2026-10-15",
        status: "failed",
        media: { photoKey: `users/${userId}/meals/x/photo` },
        error: { code: "NOT_FOOD" },
        quotaMonth,
      });
    }

    it("una comida failed devuelve el cupo", async () => {
      const { userId } = await register();
      await setUsage(userId, "2026-10", 2);
      const meal = await failedMeal(userId, "2026-10");

      assert.equal(await refundMealQuota(meal._id, now), true);
      assert.deepEqual(await usageOf(userId), { month: "2026-10", analyses: 1 });
    });

    it("un failed procesado dos veces (o a la vez) devuelve una sola vez", async () => {
      const { userId } = await register();
      await setUsage(userId, "2026-10", 2);
      const meal = await failedMeal(userId, "2026-10");

      const refunds = await Promise.all([
        refundMealQuota(meal._id, now),
        refundMealQuota(meal._id, now),
        refundMealQuota(meal._id, now),
      ]);
      assert.equal(refunds.filter(Boolean).length, 1);
      assert.equal(await refundMealQuota(meal._id, now), false);
      assert.deepEqual(await usageOf(userId), { month: "2026-10", analyses: 1 });
    });

    it("un failed de un mes anterior no toca el contador del mes actual", async () => {
      const { userId } = await register();
      await setUsage(userId, "2026-10", 2);
      const meal = await failedMeal(userId, "2026-09");

      assert.equal(await refundMealQuota(meal._id, now), false);
      assert.deepEqual(await usageOf(userId), { month: "2026-10", analyses: 2 });
    });

    it("si el mes cambió pero el contador todavía no se reinició, tampoco lo toca", async () => {
      const { userId } = await register();
      await setUsage(userId, "2026-10", 2);
      const meal = await failedMeal(userId, "2026-10");

      assert.equal(await refundMealQuota(meal._id, NOV_01_0030_MVD), false);
      assert.deepEqual(await usageOf(userId), { month: "2026-10", analyses: 2 });
    });

    it("el contador nunca queda negativo", async () => {
      const { userId } = await register();
      await setUsage(userId, "2026-10", 0);
      const meal = await failedMeal(userId, "2026-10");

      assert.equal(await refundMealQuota(meal._id, now), false);
      assert.deepEqual(await usageOf(userId), { month: "2026-10", analyses: 0 });
    });

    it("una comida que no está failed no devuelve nada", async () => {
      const { userId } = await register();
      await setUsage(userId, "2026-10", 2);
      const meal = await failedMeal(userId, "2026-10");
      await MealModel.updateOne({ _id: meal._id }, { $set: { status: "ready" } });

      assert.equal(await refundMealQuota(meal._id, now), false);
      assert.deepEqual(await usageOf(userId), { month: "2026-10", analyses: 2 });
    });
  });

  describe("requirePremium", () => {
    it("usuario free: 402 PREMIUM_REQUIRED", async () => {
      const { token } = await register();
      const res = await request(app)
        .get("/api/v1/premium-only")
        .set("authorization", `Bearer ${token}`)
        .set("x-request-id", REQUEST_ID);
      assert.equal(res.status, 402);
      assert.equal((res.body as ErrorBody).error.code, "PREMIUM_REQUIRED");
      assert.equal((res.body as ErrorBody).error.requestId, REQUEST_ID);
    });

    it("usuario premium: pasa", async () => {
      const { token, userId } = await register();
      await setTier(userId, "premium");
      const res = await request(app)
        .get("/api/v1/premium-only")
        .set("authorization", `Bearer ${token}`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { ok: true });
    });

    it("sin token: 401, no 402", async () => {
      const res = await request(app).get("/api/v1/premium-only");
      assert.equal(res.status, 401);
    });
  });

  describe("el plan se lee de la base, no del JWT", () => {
    it("pasó a premium hace segundos: entra aunque su token diga free", async () => {
      // El token se firma con plan "free"; el cambio a premium es posterior y solo está en la base.
      const { token: stale, userId } = await register();
      const claims = JSON.parse(Buffer.from(stale.split(".")[1], "base64url").toString());
      assert.equal(claims.plan, "free");
      await setTier(userId, "premium");
      await setUsage(userId, "2026-10", LIMIT);

      const premium = await request(app)
        .get("/api/v1/premium-only")
        .set("authorization", `Bearer ${stale}`);
      assert.equal(premium.status, 200);
      assert.equal((await postMeal(stale)).status, 202);
    });

    it("pasó a free: un token que dice premium no lo deja entrar ni saltear el cupo", async () => {
      const { userId } = await register();
      const forged = signAccessToken({ sub: userId, plan: "premium" }, privateKey);
      await setUsage(userId, "2026-10", LIMIT);

      const premium = await request(app)
        .get("/api/v1/premium-only")
        .set("authorization", `Bearer ${forged}`);
      assert.equal(premium.status, 402);
      assertQuotaExceeded(await postMeal(forged), "1 de noviembre");
    });
  });

  describe("helpers de mes", () => {
    it("monthIn usa la zona del usuario", () => {
      assert.equal(monthIn(TZ, OCT_31_2330_MVD), "2026-10");
      assert.equal(monthIn("UTC", OCT_31_2330_MVD), "2026-11");
      assert.equal(monthIn(TZ, NOV_01_0030_MVD), "2026-11");
    });

    it("renewalLabel da el día 1 del mes siguiente, también en diciembre", () => {
      assert.equal(renewalLabel("2026-10"), "1 de noviembre");
      assert.equal(renewalLabel("2026-12"), "1 de enero");
    });
  });
});

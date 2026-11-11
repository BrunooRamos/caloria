import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import { createLogger } from "@caloria/shared";
import { createApp } from "../src/app";
import {
  ACCOUNT_PURGE_DELAY_MS,
  ACCOUNT_PURGE_JOB,
  ACCOUNT_PURGE_JOB_OPTIONS,
  ACCOUNT_SWEEP_JOB,
  ACCOUNT_SWEEP_STALE_MS,
  accountPurgeJobId,
} from "../src/jobs/account-deletion";
import {
  createAccountPurgeProcessor,
  createAccountSweep,
} from "../src/jobs/account-deletion-processor";
import { createAccountDeletionHandler } from "../src/jobs/account-deletion-worker";
import { createMealAnalysisProcessor } from "../src/jobs/meal-analysis-processor";
import {
  createWeeklySummaryProcessor,
  markWeeklySummaryFailed,
} from "../src/jobs/weekly-summary-processor";
import { AccountDeletionModel } from "../src/models/AccountDeletion";
import { GamificationModel } from "../src/models/Gamification";
import { MealModel } from "../src/models/Meal";
import { UserModel } from "../src/models/User";
import { WeeklySummaryModel } from "../src/models/WeeklySummary";
import { apiRouter } from "../src/routes";
import {
  createAccountDeletionService,
  deleteAccountDocuments,
} from "../src/services/account-deletion";
import { createAuthService } from "../src/services/auth";
import { createBillingService } from "../src/services/billing";
import { createFakeBillingProvider } from "../src/services/billing/fake";
import type { FakeBilling } from "../src/services/billing/fake";
import { createDashboardService } from "../src/services/dashboard";
import { createMealService } from "../src/services/meals";
import type { MediaService } from "../src/services/media";
import { createSummaryService } from "../src/services/summaries";
import { signAccessToken } from "../src/services/tokens";
import { createUserService } from "../src/services/users";
import type { WeeklyData } from "../src/services/weekly-metrics";
import { captureLogger, listen, unlimitedQuota } from "./helpers";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PASSWORD = randomBytes(12).toString("base64url");
const PROFILE = {
  sex: "female",
  birthDate: "2002-04-10",
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: "America/Montevideo",
} as const;
const WEEK = "2026-W45";
const DAY = "2026-11-09";
const silent = createLogger({ service: "test", write: () => undefined });

type Envelope = { error: { code: string } };

/** Bucket en memoria, con la misma regla que S3: la media de cada cuenta vive bajo su prefijo. */
function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  let failures = 0;
  const prefix = (userId: string) => `users/${userId}/`;
  const media: MediaService = {
    async upload({ userId, mealId, kind, body }) {
      const key = `${prefix(userId)}meals/${mealId}/${kind}.${kind === "photo" ? "jpg" : "m4a"}`;
      objects.set(key, body);
      return key;
    },
    async download(key) {
      const body = objects.get(key);
      if (!body) throw new Error(`NoSuchKey: ${key}`);
      return body;
    },
    async remove(key) {
      objects.delete(key);
    },
    async removeUserMedia(userId) {
      if (failures > 0) {
        failures -= 1;
        throw new Error("el bucket no respondió");
      }
      for (const key of [...objects.keys()]) {
        if (key.startsWith(prefix(userId))) objects.delete(key);
      }
    },
    async signedUrl(key) {
      return `https://bucket.test/${key}`;
    },
  };
  return {
    media,
    objects,
    /** Los próximos `times` borrados por prefijo fallan. */
    fail(times = 1) {
      failures = times;
    },
    /** Los objetos de una cuenta, ordenados por key, con sus bytes. */
    of(userId: string) {
      return [...objects.entries()]
        .filter(([key]) => key.startsWith(prefix(userId)))
        .sort(([a], [b]) => a.localeCompare(b));
    },
  };
}

interface Account {
  id: string;
  owner: Types.ObjectId;
  accessToken: string;
  refreshToken: string;
}

describe("back-service: borrado de cuenta (RNF-04)", () => {
  let mongo: MongoMemoryServer;
  let url: string;
  let close: () => Promise<void>;
  let bucket: ReturnType<typeof memoryBucket>;
  let payments: FakeBilling;
  let enqueued: string[];
  let enqueueFails: boolean;
  let lines: Record<string, unknown>[];

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all([
      UserModel.init(),
      MealModel.init(),
      WeeklySummaryModel.init(),
      GamificationModel.init(),
      AccountDeletionModel.init(),
    ]);
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  /** Levanta la API con un proveedor de pagos falso, o sin billing configurado. */
  async function start({ withBilling = true } = {}) {
    const captured = captureLogger("back");
    lines = captured.lines;
    const billing = createBillingService({
      provider: withBilling ? payments.provider : undefined,
      quota: unlimitedQuota,
    });
    const api = apiRouter({
      auth: createAuthService({ privateKey }),
      users: createUserService(),
      meals: createMealService({
        media: bucket.media,
        queue: {
          enqueue: async () => undefined,
          ready: async () => undefined,
          close: async () => undefined,
        },
        quota: unlimitedQuota,
      }),
      dashboard: createDashboardService(),
      summaries: createSummaryService(),
      billing,
      accounts: createAccountDeletionService({
        billing,
        enqueuePurge: async (userId) => {
          if (enqueueFails) throw new Error("Redis no disponible");
          enqueued.push(userId);
        },
      }),
      publicKey,
    });
    ({ url, close } = await listen(createApp({ logger: captured.logger, api })));
  }

  /** La misma base, con la API levantada sin las claves del proveedor de pagos. */
  async function restartWithoutBilling() {
    await close();
    await start({ withBilling: false });
  }

  beforeEach(async () => {
    await Promise.all([
      UserModel.deleteMany({}),
      MealModel.deleteMany({}),
      WeeklySummaryModel.deleteMany({}),
      GamificationModel.deleteMany({}),
      AccountDeletionModel.deleteMany({}),
    ]);
    bucket = memoryBucket();
    payments = createFakeBillingProvider();
    enqueued = [];
    enqueueFails = false;
    await start();
  });

  afterEach(async () => {
    await close();
  });

  /** Una cuenta con sesión, dos comidas (una con audio), un Wrapped, la racha y su media. */
  async function seedAccount(email: string): Promise<Account> {
    const res = await fetch(`${url}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, profile: PROFILE }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as {
      accessToken: string;
      refreshToken: string;
      user: { id: string };
    };
    const id = body.user.id;
    const owner = new Types.ObjectId(id);
    for (const withAudio of [true, false]) {
      const mealId = new Types.ObjectId();
      const upload = (kind: "photo" | "audio") =>
        bucket.media.upload({
          userId: id,
          mealId: mealId.toString(),
          kind,
          body: randomBytes(64),
          contentType: kind === "photo" ? "image/jpeg" : "audio/mp4",
        });
      const photoKey = await upload("photo");
      const audioKey = withAudio ? await upload("audio") : undefined;
      await MealModel.create({
        _id: mealId,
        userId: owner,
        capturedAt: new Date(),
        localDate: DAY,
        status: "processing",
        media: { photoKey, ...(audioKey && { audioKey }) },
        note: "milanesa con puré",
      });
    }
    await WeeklySummaryModel.create({ userId: owner, week: WEEK, status: "failed" });
    await GamificationModel.create({
      userId: owner,
      streak: { current: 2, best: 4, lastLogDate: DAY },
      badges: [{ code: "first-meal", at: new Date() }],
    });
    return { id, owner, accessToken: body.accessToken, refreshToken: body.refreshToken };
  }

  /** Todo lo de una cuenta, tal como está guardado: documentos y bytes de la media. */
  async function snapshot({ owner, id }: Account) {
    return {
      user: await UserModel.findById(owner).lean(),
      meals: await MealModel.find({ userId: owner }).sort({ _id: 1 }).lean(),
      summaries: await WeeklySummaryModel.find({ userId: owner }).sort({ _id: 1 }).lean(),
      gamification: await GamificationModel.find({ userId: owner }).lean(),
      media: bucket.of(id),
    };
  }

  /** Cuánto queda de una cuenta en las cuatro collections y en el bucket. */
  async function leftovers({ owner, id }: Account) {
    return {
      users: await UserModel.countDocuments({ _id: owner }),
      meals: await MealModel.countDocuments({ userId: owner }),
      weeklySummaries: await WeeklySummaryModel.countDocuments({ userId: owner }),
      gamification: await GamificationModel.countDocuments({ userId: owner }),
      media: bucket.of(id).length,
    };
  }
  const NOTHING = { users: 0, meals: 0, weeklySummaries: 0, gamification: 0, media: 0 };

  const deleteMe = (token: string) =>
    fetch(`${url}/api/v1/users/me`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });

  const purge = (userId: string) =>
    createAccountPurgeProcessor({ media: bucket.media })({ userId }, silent);

  async function expectError(res: Response, status: number, code: string) {
    const body = (await res.json()) as Envelope;
    assert.equal(res.status, status, JSON.stringify(body));
    assert.equal(body.error.code, code);
  }

  /** Premium con una suscripción activa en el proveedor de pagos. */
  async function makePremium({ id, owner }: Account) {
    const { customerId } = await payments.provider.createSubscription({ userId: id });
    payments.completeCheckout(customerId);
    const sub = [...payments.subscriptions.values()].find((s) => s.customerId === customerId);
    assert.ok(sub);
    await UserModel.updateOne(
      { _id: owner },
      {
        $set: {
          "plan.tier": "premium",
          "plan.status": "active",
          "plan.customerId": customerId,
          "plan.subscriptionId": sub.id,
          "plan.currentPeriodEnd": sub.currentPeriodEnd,
        },
      },
    );
    return { customerId, subscriptionId: sub.id };
  }

  describe("DELETE /users/me", () => {
    it("borra solo esa cuenta: la otra queda exactamente igual, documentos y media", async () => {
      const ana = await seedAccount("ana@example.com");
      const beto = await seedAccount("beto@example.com");
      const before = await snapshot(beto);
      assert.equal(before.meals.length, 2);
      assert.equal(before.media.length, 3);

      const res = await deleteMe(ana.accessToken);
      assert.equal(res.status, 204);
      assert.equal(await res.text(), "");
      assert.equal(await purge(ana.id), "purged");

      assert.deepEqual(await snapshot(beto), before);
      assert.deepEqual(await leftovers(ana), NOTHING);
      // Nada de nadie más se perdió: lo único que queda en cada collection es de Beto.
      assert.equal(await UserModel.countDocuments(), 1);
      assert.equal(await MealModel.countDocuments(), 2);
      assert.equal(await WeeklySummaryModel.countDocuments(), 1);
      assert.equal(await GamificationModel.countDocuments(), 1);
      assert.equal(bucket.objects.size, 3);
    });

    it("al responder, los documentos ya no están; la media la borra la limpieza del Worker", async () => {
      const ana = await seedAccount("ana@example.com");

      assert.equal((await deleteMe(ana.accessToken)).status, 204);

      assert.deepEqual(await leftovers(ana), { ...NOTHING, media: 3 });
      assert.deepEqual(enqueued, [ana.id]);
      const request = await AccountDeletionModel.findById(ana.owner).lean();
      assert.ok(request?.requestedAt);
      assert.equal(request.completedAt, undefined);

      assert.equal(await purge(ana.id), "purged");
      assert.deepEqual(await leftovers(ana), NOTHING);
      const done = await AccountDeletionModel.findById(ana.owner).lean();
      assert.ok(done?.completedAt, "el pedido queda terminado");
      const log = lines.find((line) => line.msg === "cuenta eliminada");
      assert.ok(log, JSON.stringify(lines));
      assert.deepEqual(log.deleted, { users: 1, meals: 2, weeklySummaries: 1, gamification: 1 });
    });

    it("el access token y el refresh token dejan de funcionar; los de otra cuenta siguen", async () => {
      const ana = await seedAccount("ana@example.com");
      const beto = await seedAccount("beto@example.com");
      assert.equal((await deleteMe(ana.accessToken)).status, 204);

      const auth = { authorization: `Bearer ${ana.accessToken}` };
      for (const path of ["/users/me", `/meals?date=${DAY}`, `/dashboard/daily?date=${DAY}`]) {
        await expectError(
          await fetch(`${url}/api/v1${path}`, { headers: auth }),
          401,
          "UNAUTHORIZED",
        );
      }
      await expectError(
        await fetch(`${url}/api/v1/users/me`, {
          method: "PATCH",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({ tone: "roast" }),
        }),
        401,
        "UNAUTHORIZED",
      );
      await expectError(
        await fetch(`${url}/api/v1/auth/refresh`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refreshToken: ana.refreshToken }),
        }),
        401,
        "UNAUTHORIZED",
      );
      // Tampoco se puede volver a entrar con el email y la contraseña.
      await expectError(
        await fetch(`${url}/api/v1/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "ana@example.com", password: PASSWORD }),
        }),
        401,
        "UNAUTHORIZED",
      );

      const me = await fetch(`${url}/api/v1/users/me`, {
        headers: { authorization: `Bearer ${beto.accessToken}` },
      });
      assert.equal(me.status, 200);
    });

    it("repetir el pedido con el mismo token responde 204, también después de la limpieza", async () => {
      const ana = await seedAccount("ana@example.com");
      assert.equal((await deleteMe(ana.accessToken)).status, 204);
      // Se perdió la respuesta y la app reintenta.
      assert.equal((await deleteMe(ana.accessToken)).status, 204);
      assert.equal(await purge(ana.id), "purged");
      assert.equal((await deleteMe(ana.accessToken)).status, 204);
      assert.deepEqual(await leftovers(ana), NOTHING);
      // El proveedor de pagos se llama una sola vez, en el primer pedido (sin cliente, ni eso).
      assert.deepEqual(payments.calls, []);
    });

    it("un token válido de una cuenta inexistente y sin pedido de borrado → 401", async () => {
      await seedAccount("ana@example.com");
      const ghost = signAccessToken(
        { sub: new Types.ObjectId().toString(), plan: "free" },
        privateKey,
      );
      await expectError(await deleteMe(ghost), 401, "UNAUTHORIZED");
      await expectError(
        await fetch(`${url}/api/v1/users/me`, { method: "DELETE" }),
        401,
        "UNAUTHORIZED",
      );
      assert.equal(await AccountDeletionModel.countDocuments(), 0);
      assert.equal(await UserModel.countDocuments(), 1);
    });

    it("si no se puede encolar la limpieza, la cuenta igual se borra y el barrido la retoma", async () => {
      const ana = await seedAccount("ana@example.com");
      enqueueFails = true;

      assert.equal((await deleteMe(ana.accessToken)).status, 204);
      assert.deepEqual(await leftovers(ana), { ...NOTHING, media: 3 });
      assert.ok(lines.some((line) => String(line.msg).startsWith("no se pudo encolar")));

      // Una hora después, el barrido encuentra el pedido pendiente y lo vuelve a encolar.
      const later = new Date(Date.now() + ACCOUNT_SWEEP_STALE_MS + 1000);
      const swept: { userId: string; delayMs?: number }[] = [];
      const sweep = createAccountSweep({
        queue: {
          enqueuePurge: async (userId, options) => {
            swept.push({ userId, delayMs: options?.delayMs });
          },
        },
        now: () => later,
      });
      assert.deepEqual(await sweep(silent), { pending: 1 });
      assert.deepEqual(swept, [{ userId: ana.id, delayMs: 0 }]);

      assert.equal(await purge(ana.id), "purged");
      assert.deepEqual(await leftovers(ana), NOTHING);
      assert.deepEqual(await sweep(silent), { pending: 0 }, "terminado, no se vuelve a encolar");
    });
  });

  describe("suscripción en el proveedor de pagos", () => {
    it("con premium, borra el cliente en el proveedor: la suscripción termina en el momento", async () => {
      const ana = await seedAccount("ana@example.com");
      const { customerId, subscriptionId } = await makePremium(ana);

      assert.equal((await deleteMe(ana.accessToken)).status, 204);

      assert.ok(payments.deletedCustomers.has(customerId));
      assert.equal(payments.subscriptions.get(subscriptionId)?.status, "canceled");
      assert.deepEqual(await leftovers(ana), { ...NOTHING, media: 3 });
    });

    it("si el proveedor falla, responde 503 y no borra nada", async () => {
      const ana = await seedAccount("ana@example.com");
      await makePremium(ana);
      const before = await snapshot(ana);
      payments.setDown(true);

      await expectError(await deleteMe(ana.accessToken), 503, "SERVICE_UNAVAILABLE");

      assert.deepEqual(await snapshot(ana), before);
      assert.equal(await AccountDeletionModel.countDocuments(), 0);
      assert.deepEqual(enqueued, []);
      // La cuenta sigue funcionando y se puede reintentar.
      payments.setDown(false);
      assert.equal((await deleteMe(ana.accessToken)).status, 204);
      assert.deepEqual(await leftovers(ana), { ...NOTHING, media: 3 });
    });

    it("con un cliente en el proveedor y billing sin configurar, responde 503 y no borra nada", async () => {
      const ana = await seedAccount("ana@example.com");
      await makePremium(ana);
      const before = await snapshot(ana);
      await restartWithoutBilling();

      await expectError(await deleteMe(ana.accessToken), 503, "SERVICE_UNAVAILABLE");
      assert.deepEqual(await snapshot(ana), before);
    });

    it("sin cliente en el proveedor no lo llama, aunque billing no esté configurado", async () => {
      const ana = await seedAccount("ana@example.com");
      await restartWithoutBilling();

      assert.equal((await deleteMe(ana.accessToken)).status, 204);
      assert.deepEqual(payments.calls, []);
    });

    it("un webhook que llega después del borrado se acepta y no recrea la cuenta", async () => {
      const ana = await seedAccount("ana@example.com");
      const { subscriptionId } = await makePremium(ana);
      assert.equal((await deleteMe(ana.accessToken)).status, 204);

      const { body, headers } = payments.endSubscription(subscriptionId);
      const res = await fetch(`${url}/api/v1/billing/webhook`, { method: "POST", headers, body });
      assert.equal(res.status, 200);
      assert.equal(await UserModel.countDocuments({ _id: ana.owner }), 0);
    });
  });

  describe("limpieza final (Worker)", () => {
    it("si falla el bucket, lanza para que BullMQ reintente y el pedido sigue pendiente", async () => {
      const ana = await seedAccount("ana@example.com");
      assert.equal((await deleteMe(ana.accessToken)).status, 204);
      bucket.fail();

      await assert.rejects(purge(ana.id), /el bucket no respondió/);
      const pending = await AccountDeletionModel.findById(ana.owner).lean();
      assert.equal(pending?.completedAt, undefined);
      assert.equal(bucket.of(ana.id).length, 3);

      assert.equal(await purge(ana.id), "purged");
      assert.deepEqual(await leftovers(ana), NOTHING);
    });

    it("borra lo que un request en vuelo alcanzó a crear después del pedido", async () => {
      const ana = await seedAccount("ana@example.com");
      assert.equal((await deleteMe(ana.accessToken)).status, 204);
      // Un POST /meals que pasó el control de sesión antes del borrado termina después.
      const mealId = new Types.ObjectId();
      const photoKey = await bucket.media.upload({
        userId: ana.id,
        mealId: mealId.toString(),
        kind: "photo",
        body: randomBytes(32),
        contentType: "image/jpeg",
      });
      await MealModel.create({
        _id: mealId,
        userId: ana.owner,
        capturedAt: new Date(),
        localDate: DAY,
        status: "processing",
        media: { photoKey },
      });
      await GamificationModel.create({
        userId: ana.owner,
        streak: { current: 1, best: 1, lastLogDate: DAY },
      });

      assert.equal(await purge(ana.id), "purged");
      assert.deepEqual(await leftovers(ana), NOTHING);
    });

    it("sin un pedido de borrado registrado no borra nada", async () => {
      const ana = await seedAccount("ana@example.com");
      const before = await snapshot(ana);

      assert.equal(await purge(ana.id), "no-request");
      assert.deepEqual(await snapshot(ana), before);
    });

    it("un id vacío o inválido lanza antes de llegar a Mongo", async () => {
      const ana = await seedAccount("ana@example.com");
      for (const bad of ["", "undefined", "66f1", new Types.ObjectId().toString().toUpperCase()]) {
        await assert.rejects(deleteAccountDocuments(bad), /Id de usuario inválido/);
        await assert.rejects(purge(bad), /Id de usuario inválido/);
      }
      assert.deepEqual(await leftovers(ana), {
        users: 1,
        meals: 2,
        weeklySummaries: 1,
        gamification: 1,
        media: 3,
      });
    });

    it("el job se reintenta con backoff durante cerca de una hora y espera un minuto antes", () => {
      assert.equal(ACCOUNT_PURGE_JOB_OPTIONS.attempts, 8);
      assert.deepEqual(ACCOUNT_PURGE_JOB_OPTIONS.backoff, { type: "exponential", delay: 30_000 });
      // El jobId se libera al terminar, así el barrido puede volver a encolarlo.
      assert.equal(ACCOUNT_PURGE_JOB_OPTIONS.removeOnComplete, true);
      assert.equal(ACCOUNT_PURGE_JOB_OPTIONS.removeOnFail, true);
      assert.equal(
        accountPurgeJobId("66f1a0000000000000000001"),
        "account-66f1a0000000000000000001",
      );
      // Más que lo que tarda un POST /meals en vuelo (el Front corta a los 10 s).
      assert.ok(ACCOUNT_PURGE_DELAY_MS >= 30_000);
    });

    it("el handler loguea el resultado y vuelve a tirar el error para que BullMQ reintente", async () => {
      const ana = await seedAccount("ana@example.com");
      assert.equal((await deleteMe(ana.accessToken)).status, 204);
      const { logger, lines: workerLines } = captureLogger("worker");
      const handle = createAccountDeletionHandler(
        {
          purge: createAccountPurgeProcessor({ media: bucket.media }),
          sweep: async () => ({ pending: 0 }),
        },
        logger,
      );
      const opts = { attempts: ACCOUNT_PURGE_JOB_OPTIONS.attempts };
      bucket.fail();
      await assert.rejects(
        handle({ name: ACCOUNT_PURGE_JOB, data: { userId: ana.id }, attemptsMade: 0, opts }),
      );
      const failed = workerLines.find((line) => line.msg === "job de borrado de cuenta falló");
      assert.equal(failed?.willRetry, true);
      assert.equal(failed?.userId, ana.id);

      await handle({ name: ACCOUNT_PURGE_JOB, data: { userId: ana.id }, attemptsMade: 1, opts });
      const done = workerLines.find((line) => line.msg === "job de borrado de cuenta terminado");
      assert.equal(done?.outcome, "purged");
      await handle({ name: ACCOUNT_SWEEP_JOB, data: {}, attemptsMade: 0, opts: {} });
      await assert.rejects(
        handle({ name: "otro", data: {}, attemptsMade: 0, opts: {} }),
        /Job desconocido/,
      );
    });
  });

  describe("lo que está en vuelo en el Worker", () => {
    const neverDownload: MediaService = {
      ...memoryBucket().media,
      download: () => Promise.reject(new Error("no se tenía que bajar la foto")),
    };
    const neverAnalyze = () => Promise.reject(new Error("no se tenía que llamar a la IA"));

    it("un análisis encolado para una comida borrada termina sin error y sin recrear nada", async () => {
      const ana = await seedAccount("ana@example.com");
      const [meal] = await MealModel.find({ userId: ana.owner }).lean();
      assert.equal((await deleteMe(ana.accessToken)).status, 204);
      assert.equal(await purge(ana.id), "purged");

      const processor = createMealAnalysisProcessor({
        media: neverDownload,
        analyze: neverAnalyze,
      });
      assert.equal(
        await processor({ mealId: meal._id.toString(), requestId: "r" }, silent),
        "missing",
      );
      assert.deepEqual(await leftovers(ana), NOTHING);
    });

    it("el análisis de una comida cuya cuenta ya no existe no baja la foto ni llama a la IA", async () => {
      const ana = await seedAccount("ana@example.com");
      const [meal] = await MealModel.find({ userId: ana.owner }).lean();
      // La cuenta se borró y la comida todavía no (la limpieza corre un minuto después).
      await UserModel.deleteOne({ _id: ana.owner });

      const processor = createMealAnalysisProcessor({
        media: neverDownload,
        analyze: neverAnalyze,
      });
      const outcome = await processor({ mealId: meal._id.toString(), requestId: "r" }, silent);
      assert.equal(outcome, "account-deleted");
      assert.equal((await MealModel.findById(meal._id).lean())?.status, "processing");
    });

    const weeklyData = (userId: string): WeeklyData =>
      ({ userId, week: WEEK, metrics: {}, days: [] }) as unknown as WeeklyData;
    const notifications = {
      calls: [] as string[],
      async notifyWrappedReady(userId: string) {
        this.calls.push(userId);
        return "sent" as const;
      },
    };

    it("el Wrapped de una cuenta borrada no llama a la IA ni crea el resumen", async () => {
      const ana = await seedAccount("ana@example.com");
      assert.equal((await deleteMe(ana.accessToken)).status, 204);
      let insightCalls = 0;
      const processor = createWeeklySummaryProcessor({
        metrics: { compute: async (userId) => weeklyData(userId) },
        insights: {
          model: "m",
          promptVersion: "1",
          generate: async () => {
            insightCalls += 1;
            throw new Error("no se tenía que llamar a la IA");
          },
        } as never,
        notifications,
      });

      const outcome = await processor({ userId: ana.id, week: WEEK }, silent);
      assert.equal(outcome, "account-deleted");
      assert.equal(insightCalls, 0);
      assert.equal(await WeeklySummaryModel.countDocuments({ userId: ana.owner }), 0);
    });

    it("si la cuenta se borra mientras la IA genera el Wrapped, no se guarda ni se avisa", async () => {
      const ana = await seedAccount("ana@example.com");
      await WeeklySummaryModel.deleteMany({ userId: ana.owner });
      notifications.calls = [];
      const processor = createWeeklySummaryProcessor({
        metrics: { compute: async (userId) => weeklyData(userId) },
        insights: {
          model: "m",
          promptVersion: "1",
          generate: async () => {
            // Mientras la IA responde, la persona borra su cuenta.
            assert.equal((await deleteMe(ana.accessToken)).status, 204);
            return { insights: ["uno", "dos", "tres"], model: "m", promptVersion: "1", usage: {} };
          },
        } as never,
        notifications,
      });

      const outcome = await processor({ userId: ana.id, week: WEEK }, silent);
      assert.equal(outcome, "account-deleted");
      assert.equal(await WeeklySummaryModel.countDocuments({ userId: ana.owner }), 0);
      assert.deepEqual(notifications.calls, []);
    });

    it("marcar failed el Wrapped de una cuenta borrada no crea el resumen", async () => {
      const ana = await seedAccount("ana@example.com");
      assert.equal((await deleteMe(ana.accessToken)).status, 204);

      await markWeeklySummaryFailed({ userId: ana.id, week: "2026-W46" });
      assert.equal(await WeeklySummaryModel.countDocuments({ userId: ana.owner }), 0);
    });
  });
});

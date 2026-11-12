import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { Router } from "express";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app";
import { estimateCostUsd, priceFor } from "../src/config/ai-pricing";
import { loadConfig } from "../src/config";
import { createAnalyzeMeal, NOT_FOOD } from "../src/jobs/analyze-meal";
import type { MealAnalysisJob, MealAnalysisQueue } from "../src/jobs/meal-analysis";
import { createMealAnalysisProcessor } from "../src/jobs/meal-analysis-processor";
import { AiUsageModel } from "../src/models/AiUsage";
import { MealModel } from "../src/models/Meal";
import { UserModel } from "../src/models/User";
import { apiRouter } from "../src/routes";
import { formatMonthlyAiCosts, monthlyAiCosts, monthRange } from "../src/services/ai-costs";
import { createAuthService } from "../src/services/auth";
import { parseCommentResponse } from "../src/services/comment";
import type { CommentService } from "../src/services/comment";
import type { DishIdentifier } from "../src/services/dish-identifier";
import { createMealService, mealInputHash } from "../src/services/meals";
import type { MediaService } from "../src/services/media";
import { createQuotaService, secondsUntilNextLocalDay } from "../src/services/quota";
import { createMongoSimilarMealsFinder } from "../src/services/similar-meals";
import type { TranscriptionService } from "../src/services/transcription";
import { createUserService } from "../src/services/users";
import { parseVisionResponse } from "../src/services/vision";
import type { VisionService } from "../src/services/vision";
import { captureLogger, fixtures, storageEnv } from "./helpers";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const TZ = "America/Montevideo";
// 11/11/2026 15:00 en Montevideo (UTC-3): faltan 9 h para la medianoche local.
const NOV_11_1500_MVD = new Date("2026-11-11T18:00:00Z");
const NOV_12_0001_MVD = new Date("2026-11-12T03:01:00Z");
const FREE_MONTHLY = 40; // el N de producción (docs/requerimientos.md)

const profile = {
  sex: "female",
  birthDate: "2002-04-10",
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: TZ,
} as const;

const range = (min: number, max: number) => ({ min, max });
const FOOD = {
  isFood: true,
  analysis: {
    dish: "Milanesa con puré",
    items: [{ name: "Milanesa", grams: range(150, 190), kcal: range(380, 470) }],
    kcal: range(620, 780),
    macros: { protein: range(38, 46), carbs: range(50, 65), fat: range(28, 38) },
    confidence: 0.72,
  },
};

type ErrorBody = { error: { code: string; message: string; requestId: string } };

/** Bucket en memoria. */
function memoryMedia(): MediaService {
  const objects = new Map<string, Uint8Array>();
  return {
    async upload({ userId, mealId, kind, body }) {
      const key = `users/${userId}/meals/${mealId}/${kind}`;
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
}

/** IA falsa que cuenta las llamadas y reporta tokens de gpt-6-luna, para que haya costo. */
function fakeAi(respond: () => unknown = () => FOOD) {
  const calls = { vision: 0, comment: 0, transcription: 0, identify: 0 };
  const vision: VisionService = {
    async analyze() {
      calls.vision++;
      return parseVisionResponse(JSON.stringify(respond()), {
        model: "gpt-6-luna-2026-10-05",
        promptVersion: "1.0.0-test",
        usage: { input: 1500, output: 400, total: 1900 },
      });
    },
  };
  const commenter: CommentService = {
    model: "gpt-6-luna",
    promptVersion: "1.0.0-test",
    async comment() {
      calls.comment++;
      return parseCommentResponse(JSON.stringify({ text: "Un clásico que no falla." }), {
        input: 300,
        output: 20,
        total: 320,
      });
    },
  };
  const transcriber: TranscriptionService = {
    model: "gpt-transcribe",
    async transcribe() {
      calls.transcription++;
      return "le puse aceite de oliva";
    },
  };
  const identifier: DishIdentifier = {
    async identify() {
      calls.identify++;
      return { dish: "milanesa", items: [], model: "gpt-6-luna", promptVersion: "1.0.0-test" };
    },
  };
  return { calls, vision, commenter, transcriber, identifier };
}

describe("back-service: abuso y costos de IA (RNF-07)", () => {
  let mongo: MongoMemoryServer;
  let now: Date;
  let media: MediaService;
  let jobs: MealAnalysisJob[];
  let failEnqueue: boolean;
  let app: ReturnType<typeof createApp>;
  let ai: ReturnType<typeof fakeAi>;
  let workerLogs: Record<string, unknown>[];
  let processJobs: () => Promise<void>;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all([UserModel.init(), MealModel.init(), AiUsageModel.init()]);
  });
  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      UserModel.deleteMany({}),
      MealModel.deleteMany({}),
      AiUsageModel.deleteMany({}),
    ]);
    now = NOV_11_1500_MVD;
    const clock = () => now;
    media = memoryMedia();
    jobs = [];
    failEnqueue = false;
    const queue: MealAnalysisQueue = {
      async enqueue(job) {
        if (failEnqueue) throw new Error("Redis caído");
        jobs.push(job);
      },
      async ready() {},
      async close() {},
    };
    const { logger } = captureLogger("back");
    const api = Router();
    api.use(
      apiRouter({
        auth: createAuthService({ privateKey }),
        users: createUserService(),
        meals: createMealService({
          media,
          queue,
          quota: createQuotaService({ freeMonthlyAnalyses: FREE_MONTHLY, now: clock }),
          now: clock,
        }),
        publicKey,
      }),
    );
    app = createApp({ logger, api });

    ai = fakeAi();
    const worker = captureLogger("worker");
    workerLogs = worker.lines;
    const processor = createMealAnalysisProcessor({
      media,
      analyze: createAnalyzeMeal({
        ...ai,
        similarMeals: createMongoSimilarMealsFinder(),
        notifications: { notify: async () => "sent" as const },
      }),
    });
    // Corre los jobs encolados en orden, como el worker.
    processJobs = async () => {
      for (const job of jobs.splice(0)) await processor(job, worker.logger);
    };
  });

  async function register(email = "cami@example.com") {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email, password: "una-password-larga", profile });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { token: res.body.accessToken as string, userId: res.body.user.id as string };
  }

  function postMeal(
    token: string,
    {
      photo = fixtures.jpeg(),
      note,
      audio,
    }: { photo?: Buffer; note?: string; audio?: Buffer } = {},
  ) {
    const req = request(app)
      .post("/api/v1/meals")
      .set("authorization", `Bearer ${token}`)
      .attach("photo", photo, { filename: "plato.jpg", contentType: "image/jpeg" });
    if (note !== undefined) req.field("note", note);
    if (audio) req.attach("audio", audio, { filename: "nota.m4a", contentType: "audio/mp4" });
    return req;
  }

  const setTier = (userId: string, tier: "free" | "premium") =>
    UserModel.updateOne({ _id: userId }, { $set: { "plan.tier": tier } });

  describe("tope diario de fotos por usuario y plan", () => {
    it("free: analiza 20 fotos en el día y la 21 da 429 con Retry-After hasta la medianoche", async () => {
      const { token, userId } = await register();
      for (let i = 1; i <= 20; i++) {
        const res = await postMeal(token, { photo: fixtures.jpeg(1024 + i) });
        assert.equal(res.status, 202, `foto ${i}: ${JSON.stringify(res.body)}`);
      }

      const res = await postMeal(token, { photo: fixtures.jpeg(2048) });
      const body = res.body as ErrorBody;
      assert.equal(res.status, 429, JSON.stringify(body));
      assert.equal(body.error.code, "DAILY_LIMIT_EXCEEDED");
      // 15:00 en Montevideo: 9 h hasta la medianoche local.
      assert.equal(res.headers["retry-after"], String(9 * 3600));
      assert.match(body.error.message, /20 fotos por día/);
      assert.match(body.error.message, /9 horas/);

      // La rechazada no deja comida, ni consume cupo mensual.
      assert.equal(await MealModel.countDocuments({ userId }), 20);
      const user = await UserModel.findById(userId).lean();
      assert.deepEqual(user?.dailyUsage, { date: "2026-11-11", analyses: 20 });
      assert.deepEqual(user?.usage, { month: "2026-11", analyses: 20 });
    });

    it("al otro día (medianoche local) vuelve a dejar", async () => {
      const { token, userId } = await register();
      await UserModel.updateOne(
        { _id: userId },
        { $set: { dailyUsage: { date: "2026-11-11", analyses: 20 } } },
      );
      assert.equal((await postMeal(token)).status, 429);
      now = NOV_12_0001_MVD;
      assert.equal((await postMeal(token)).status, 202);
      const user = await UserModel.findById(userId).lean();
      assert.deepEqual(user?.dailyUsage, { date: "2026-11-12", analyses: 1 });
    });

    it("premium: 100 por día y la 101 da 429", async () => {
      const { token, userId } = await register();
      await setTier(userId, "premium");
      await UserModel.updateOne(
        { _id: userId },
        { $set: { dailyUsage: { date: "2026-11-11", analyses: 99 } } },
      );
      assert.equal((await postMeal(token)).status, 202);
      const res = await postMeal(token);
      assert.equal(res.status, 429);
      assert.match((res.body as ErrorBody).error.message, /100 fotos por día/);
    });

    it("si se rechaza por el cupo mensual, la foto no cuenta para el día", async () => {
      const { token, userId } = await register();
      await UserModel.updateOne(
        { _id: userId },
        { $set: { usage: { month: "2026-11", analyses: FREE_MONTHLY } } },
      );
      assert.equal((await postMeal(token)).status, 402);
      const user = await UserModel.findById(userId).lean();
      assert.equal(user?.dailyUsage?.analyses, 0);
    });

    it("con un solo lugar libre y varias requests a la vez, pasa una sola", async () => {
      const { token, userId } = await register();
      await UserModel.updateOne(
        { _id: userId },
        { $set: { dailyUsage: { date: "2026-11-11", analyses: 19 } } },
      );
      const results = await Promise.all(Array.from({ length: 6 }, () => postMeal(token)));
      assert.deepEqual(results.map((r) => r.status).sort(), [202, 429, 429, 429, 429, 429]);
    });

    it("cambiar de zona no reinicia el tope, y el Retry-After apunta al día que se agotó", async () => {
      const { token, userId } = await register();
      const setZone = (timezone: string) =>
        request(app)
          .patch("/api/v1/users/me")
          .set("authorization", `Bearer ${token}`)
          .send({ profile: { timezone } });
      // 15:00 en Montevideo = 03:00 del 12 en Tokio: agota el 12 desde Tokio.
      assert.equal((await setZone("Asia/Tokyo")).status, 200);
      await UserModel.updateOne(
        { _id: userId },
        { $set: { dailyUsage: { date: "2026-11-12", analyses: 20 } } },
      );
      assert.equal((await postMeal(token)).status, 429);

      // De vuelta en Montevideo todavía es el 11: no se reinicia (si no, ir y volver de zona
      // daría fotos de más). Recién se libera a la medianoche del 12 al 13 de Montevideo.
      assert.equal((await setZone(TZ)).status, 200);
      const res = await postMeal(token);
      assert.equal(res.status, 429);
      assert.equal(res.headers["retry-after"], String(9 * 3600 + 24 * 3600));
      assert.match((res.body as ErrorBody).error.message, /33 horas/);
      const user = await UserModel.findById(userId).lean();
      assert.deepEqual(user?.dailyUsage, { date: "2026-11-12", analyses: 20 });
    });

    it("con el día guardado adelante, una foto que no se crea devuelve el lugar de ese día", async () => {
      const { token, userId } = await register();
      await UserModel.updateOne(
        { _id: userId },
        { $set: { dailyUsage: { date: "2026-11-12", analyses: 5 } } },
      );
      failEnqueue = true;
      assert.equal((await postMeal(token)).status, 503);
      const user = await UserModel.findById(userId).lean();
      assert.deepEqual(user?.dailyUsage, { date: "2026-11-12", analyses: 5 });
    });

    it("si falla el encolado, la foto no cuenta para el día (la IA no se llamó)", async () => {
      const { token, userId } = await register();
      assert.equal((await postMeal(token)).status, 202);
      failEnqueue = true;
      assert.equal((await postMeal(token)).status, 503);
      // El cupo mensual y el diario vuelven en segundo plano: se espera a que se apliquen.
      for (let i = 0; i < 50; i++) {
        const user = await UserModel.findById(userId).lean();
        if (user?.dailyUsage?.analyses === 1 && user.usage.analyses === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const user = await UserModel.findById(userId).lean();
      assert.deepEqual(user?.dailyUsage, { date: "2026-11-11", analyses: 1 });
      assert.equal(user?.usage.analyses, 1);
    });

    it("secondsUntilNextLocalDay usa la zona del usuario", () => {
      assert.equal(secondsUntilNextLocalDay(TZ, NOV_11_1500_MVD), 9 * 3600);
      // Las 18:00 UTC ya son las 03:00 del 12 en Tokio: faltan 21 h para su medianoche.
      assert.equal(secondsUntilNextLocalDay("Asia/Tokyo", NOV_11_1500_MVD), 21 * 3600);
    });

    it("los topes se configuran por entorno y validan", () => {
      const base = {
        MONGO_URI: "mongodb://x",
        REDIS_URL: "redis://x",
        FREE_MONTHLY_ANALYSES: "40",
        JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        ...storageEnv,
      };
      assert.deepEqual(loadConfig(base).dailyAnalyses, { free: 20, premium: 100 });
      assert.deepEqual(
        loadConfig({ ...base, DAILY_ANALYSES_FREE: "5", DAILY_ANALYSES_PREMIUM: "50" })
          .dailyAnalyses,
        { free: 5, premium: 50 },
      );
      assert.throws(() => loadConfig({ ...base, DAILY_ANALYSES_FREE: "0" }), /DAILY_ANALYSES_FREE/);
    });
  });

  describe("cache del análisis por hash de la entrada", () => {
    it("la misma foto subida dos veces llama a la IA una sola vez", async () => {
      const { token } = await register();
      const photo = fixtures.jpeg(4096);
      const first = await postMeal(token, { photo, note: "con puré" });
      const second = await postMeal(token, { photo, note: "con puré" });
      assert.equal(first.status, 202);
      assert.equal(second.status, 202);
      await processJobs();

      assert.equal(ai.calls.vision, 1);
      assert.equal(ai.calls.comment, 1, "el comentario también se reusa (mismo tono)");
      const [a, b] = await Promise.all([
        MealModel.findById(first.body.mealId).lean(),
        MealModel.findById(second.body.mealId).lean(),
      ]);
      assert.equal(a?.status, "ready");
      assert.equal(b?.status, "ready");
      assert.deepEqual(b?.analysis, a?.analysis);
      assert.deepEqual(b?.comment, a?.comment);
      assert.equal(b?.cachedFrom?.toString(), a?._id.toString());
      assert.equal(a?.inputHash, b?.inputHash);

      // Solo la primera dejó costo registrado.
      assert.equal(await AiUsageModel.countDocuments({ kind: "analysis" }), 1);
      const cached = workerLogs.find((l) => l.msg === "análisis de la IA" && l.cached === true);
      assert.ok(cached, "se loguea el acierto de cache");
    });

    it("con el mismo audio reusa también la transcripción, sin volver a transcribir", async () => {
      const { token } = await register();
      const photo = fixtures.jpeg(4096);
      const audio = fixtures.m4a(12);
      await postMeal(token, { photo, audio });
      await postMeal(token, { photo, audio });
      await processJobs();
      assert.deepEqual([ai.calls.vision, ai.calls.transcription], [1, 1]);
      const meals = await MealModel.find().sort({ capturedAt: 1, _id: 1 }).lean();
      assert.equal(meals[1].transcript, meals[0].transcript);
    });

    it("otra nota, otro audio u otra foto no usan la cache", async () => {
      const { token } = await register();
      const photo = fixtures.jpeg(4096);
      await postMeal(token, { photo, note: "con puré" });
      await postMeal(token, { photo, note: "con ensalada" });
      await postMeal(token, { photo, note: "con puré", audio: fixtures.m4a(5) });
      await postMeal(token, { photo: fixtures.jpeg(4097), note: "con puré" });
      await processJobs();
      assert.equal(ai.calls.vision, 4);
      assert.equal(await MealModel.countDocuments({ cachedFrom: { $exists: true } }), 0);
    });

    it("no cruza usuarios: la misma foto de otra cuenta se analiza de nuevo", async () => {
      const photo = fixtures.jpeg(4096);
      await postMeal((await register("a@example.com")).token, { photo });
      await postMeal((await register("b@example.com")).token, { photo });
      await processJobs();
      assert.equal(ai.calls.vision, 2);
    });

    it("si el usuario cambió de tono, reusa el análisis pero genera un comentario nuevo", async () => {
      const { token, userId } = await register();
      const photo = fixtures.jpeg(4096);
      await postMeal(token, { photo });
      await processJobs();
      await UserModel.updateOne({ _id: userId }, { $set: { tone: "sarcastico" } });
      await postMeal(token, { photo });
      await processJobs();
      assert.deepEqual([ai.calls.vision, ai.calls.comment], [1, 2]);
      const second = await MealModel.findOne({ cachedFrom: { $exists: true } }).lean();
      assert.equal(second?.comment?.tone, "sarcastico");
    });

    it("una foto que no era comida sigue sin serlo: failed NOT_FOOD sin llamar a la IA", async () => {
      ai = fakeAi(() => ({ isFood: false, analysis: null }));
      const processor = createMealAnalysisProcessor({
        media,
        analyze: createAnalyzeMeal({
          ...ai,
          similarMeals: createMongoSimilarMealsFinder(),
          notifications: { notify: async () => "sent" as const },
        }),
      });
      const { token, userId } = await register();
      const photo = fixtures.jpeg(4096);
      await postMeal(token, { photo });
      await postMeal(token, { photo });
      const { logger } = captureLogger("worker");
      for (const job of jobs.splice(0)) await processor(job, logger);

      assert.equal(ai.calls.vision, 1);
      const meals = await MealModel.find().lean();
      assert.deepEqual(
        meals.map((m) => m.error?.code),
        [NOT_FOOD, NOT_FOOD],
      );
      // Las dos devuelven el cupo mensual, como cualquier NOT_FOOD.
      const user = await UserModel.findById(userId).lean();
      assert.equal(user?.usage.analyses, 0);
    });

    it("el hash separa las partes: correr bytes entre foto y nota cambia la huella", () => {
      const photo = { buffer: fixtures.jpeg(10), contentType: "image/jpeg" as const };
      const base = mealInputHash({ photo, note: "abc" });
      assert.equal(base, mealInputHash({ photo, note: "  abc " }), "la nota se compara sin bordes");
      assert.notEqual(base, mealInputHash({ photo, note: "abd" }));
      assert.notEqual(
        base,
        mealInputHash({
          photo: { ...photo, buffer: Buffer.concat([photo.buffer, Buffer.from("a")]) },
          note: "bc",
        }),
      );
      assert.match(base, /^[0-9a-f]{64}$/);
    });
  });

  describe("costo de cada llamada y resumen del mes", () => {
    it("estima el costo con la tabla de precios, también con el modelo fechado", () => {
      assert.ok(priceFor("gpt-6-luna-2026-10-05"));
      assert.equal(priceFor("gpt-6-lunar"), undefined);
      // 1500 × 0,10 + 400 × 0,50 por millón = 0,00035 USD.
      assert.equal(
        estimateCostUsd({ model: "gpt-6-luna", usage: { input: 1500, output: 400 } }),
        0.00035,
      );
      // 12 s de audio a 0,0045 USD el minuto.
      assert.equal(estimateCostUsd({ model: "gpt-transcribe", audioSeconds: 12 }), 0.0009);
      assert.equal(
        estimateCostUsd({ model: "modelo-nuevo", usage: { input: 1, output: 1 } }),
        null,
      );
    });

    it("cada llamada a la IA queda registrada con su costo, sin contenido", async () => {
      const { token, userId } = await register();
      await postMeal(token, { audio: fixtures.m4a(12), note: "nota privada" });
      await processJobs();

      const rows = await AiUsageModel.find().lean();
      assert.deepEqual(rows.map((r) => r.kind).sort(), ["analysis", "comment", "transcription"]);
      for (const row of rows) {
        assert.equal(row.userId?.toString(), userId);
        assert.ok(row.mealId);
        assert.equal(typeof row.costUsd, "number");
      }
      const transcription = rows.find((r) => r.kind === "transcription");
      assert.equal(transcription?.audioSeconds, 12);
      assert.ok(!JSON.stringify(rows).includes("nota privada"));
      assert.ok(!JSON.stringify(workerLogs).includes("nota privada"));
      assert.ok(workerLogs.some((l) => l.msg === "costo de IA" && l.kind === "analysis"));
    });

    it("resume el mes: total, por tipo, usuarios activos y promedio por usuario", async () => {
      const a = await register("a@example.com");
      const b = await register("b@example.com");
      const photo = fixtures.jpeg(4096);
      await postMeal(a.token, { photo });
      await postMeal(a.token, { photo }); // cache: no suma costo
      await postMeal(b.token);
      await processJobs();
      // Una llamada de otro mes no entra.
      await AiUsageModel.create({
        at: new Date("2026-10-31T23:59:59Z"),
        kind: "analysis",
        model: "gpt-6-luna",
        costUsd: 99,
      });

      const report = await monthlyAiCosts("2026-11");
      // 2 análisis (0,00035) + 2 comentarios (300 × 0,10 + 20 × 0,50 por millón = 0,00004).
      const expected = 2 * 0.00035 + 2 * 0.00004;
      assert.equal(report.calls, 4);
      assert.ok(Math.abs(report.costUsd - expected) < 1e-12, String(report.costUsd));
      assert.equal(report.activeUsers, 2);
      assert.ok(Math.abs((report.costPerActiveUserUsd ?? 0) - expected / 2) < 1e-12);
      assert.equal(report.cachedAnalyses, 1);
      assert.equal(report.byKind.analysis?.calls, 2);
      assert.equal(report.unpricedCalls, 0);

      const text = formatMonthlyAiCosts(report);
      assert.match(text, /Costo de IA de 2026-11/);
      assert.match(text, /Usuarios activos:\s+2/);
    });

    it("monthRange valida el mes", () => {
      assert.deepEqual(monthRange("2026-12"), {
        from: new Date("2026-12-01T00:00:00Z"),
        to: new Date("2027-01-01T00:00:00Z"),
      });
      assert.throws(() => monthRange("2026-13"), /YYYY-MM/);
    });
  });
});

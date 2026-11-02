import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { S3Client } from "@aws-sdk/client-s3";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { createApp } from "../src/app";
import { loadStorageConfig } from "../src/config/storage";
import type { MealAnalysisQueue } from "../src/jobs/meal-analysis";
import { GamificationModel } from "../src/models/Gamification";
import { MealModel } from "../src/models/Meal";
import { UserModel } from "../src/models/User";
import { apiRouter } from "../src/routes";
import { createAuthService } from "../src/services/auth";
import { createDashboardService } from "../src/services/dashboard";
import { createMealService, STREAK_TIMEOUT_MS } from "../src/services/meals";
import { createMediaService } from "../src/services/media";
import { createStreakService, previousDay, streakAsOf } from "../src/services/streak";
import type { StreakService } from "../src/services/streak";
import { computeTargets } from "../src/services/targets";
import { signAccessToken } from "../src/services/tokens";
import { createUserService } from "../src/services/users";
import { captureLogger, fixtures, listen, storageEnv } from "./helpers";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const REQUEST_ID = "0b6f3c1e-7d2a-4c5b-9e8f-1a2b3c4d5e6f";
const profile = {
  sex: "female",
  birthDate: "2002-04-10",
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: "America/Montevideo",
} as const;

const noopQueue: MealAnalysisQueue = {
  async enqueue() {},
  async ready() {},
  async close() {},
};

/** Mediodía en Montevideo (UTC-3) del día dado. */
const noonMvd = (day: string) => new Date(`${day}T15:00:00Z`);

describe("previousDay", () => {
  for (const [date, expected] of [
    ["2026-10-27", "2026-10-26"],
    ["2026-11-01", "2026-10-31"],
    ["2026-01-01", "2025-12-31"],
    ["2028-03-01", "2028-02-29"],
    ["2026-03-01", "2026-02-28"],
    // Días de cambio de horario en Nueva York: siguen siendo un día de calendario.
    ["2026-03-09", "2026-03-08"],
    ["2026-11-02", "2026-11-01"],
  ] as const) {
    it(`${date} → ${expected}`, () => assert.equal(previousDay(date), expected));
  }
});

describe("streakAsOf", () => {
  const streak = { current: 4, best: 12, lastLogDate: "2026-10-27" };
  it("sin documento → 0 y 0", () =>
    assert.deepEqual(streakAsOf(undefined, "2026-10-28"), { current: 0, best: 0 }));
  it("último registro hoy o ayer → la guardada", () => {
    assert.deepEqual(streakAsOf(streak, "2026-10-27"), { current: 4, best: 12 });
    assert.deepEqual(streakAsOf(streak, "2026-10-28"), { current: 4, best: 12 });
  });
  it("último registro hace dos días o más → current 0, best tal cual", () => {
    assert.deepEqual(streakAsOf(streak, "2026-10-29"), { current: 0, best: 12 });
    assert.deepEqual(streakAsOf(streak, "2026-12-01"), { current: 0, best: 12 });
  });
});

describe("back-service: racha (RF-10)", () => {
  let mongo: MongoMemoryServer;
  let userId: string;
  let token: string;
  let clock: Date;

  async function startApp(streak?: StreakService) {
    const { logger, lines } = captureLogger("back");
    const now = () => clock;
    const meals = createMealService({
      media: createMediaService(loadStorageConfig(storageEnv)),
      queue: noopQueue,
      now,
      ...(streak && { streak }),
    });
    const api = apiRouter({
      auth: createAuthService({ privateKey }),
      users: createUserService(),
      meals,
      dashboard: createDashboardService({ now }),
      publicKey,
    });
    return { ...(await listen(createApp({ logger, api }))), lines };
  }

  let app: Awaited<ReturnType<typeof startApp>>;

  async function postMeal(url = app.url) {
    const form = new FormData();
    form.append(
      "photo",
      new Blob([new Uint8Array(fixtures.jpeg())], { type: "image/jpeg" }),
      "plato.jpg",
    );
    const res = await fetch(`${url}/api/v1/meals`, {
      method: "POST",
      headers: { "x-request-id": REQUEST_ID, authorization: `Bearer ${token}` },
      body: form,
    });
    const body = (await res.json()) as { mealId: string };
    assert.equal(res.status, 202, JSON.stringify(body));
    return body.mealId;
  }

  async function logAt(at: Date) {
    clock = at;
    return postMeal();
  }

  async function storedStreak() {
    const doc = await GamificationModel.findOne({ userId }).lean();
    return doc?.streak;
  }

  async function dashboardStreak(query = "") {
    const res = await fetch(`${app.url}/api/v1/dashboard/daily${query}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as { streak: unknown };
    assert.equal(res.status, 200, JSON.stringify(body));
    return body.streak;
  }

  async function setTimezone(timezone: string) {
    await UserModel.updateOne({ _id: userId }, { $set: { "profile.timezone": timezone } });
  }

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all([UserModel.init(), MealModel.init(), GamificationModel.init()]);
    const user = await UserModel.create({
      email: "cami@example.com",
      passwordHash: "no-se-usa",
      profile,
      targets: computeTargets(profile),
    });
    userId = user.id as string;
    token = signAccessToken({ sub: userId, plan: "free" }, privateKey);
    mock.method(S3Client.prototype, "send", async () => ({}));
    app = await startApp();
  });
  after(async () => {
    await app.close();
    mock.restoreAll();
    await mongoose.disconnect();
    await mongo.stop();
  });
  beforeEach(async () => {
    await Promise.all([MealModel.deleteMany({}), GamificationModel.deleteMany({})]);
    await setTimezone(profile.timezone);
    app.lines.length = 0;
  });

  it("gamification tiene índice único por userId", async () => {
    const indexes = await GamificationModel.collection.indexes();
    const index = indexes.find((i) => JSON.stringify(i.key) === '{"userId":1}');
    assert.equal(index?.unique, true);
  });

  it("la primera comida crea el documento con racha 1", async () => {
    await logAt(noonMvd("2026-10-20"));
    const docs = await GamificationModel.find({ userId }).lean();
    assert.equal(docs.length, 1);
    assert.deepEqual(docs[0].streak, { current: 1, best: 1, lastLogDate: "2026-10-20" });
    assert.deepEqual(docs[0].badges, []);
  });

  it("dos comidas el mismo día dejan la racha en 1", async () => {
    await logAt(noonMvd("2026-10-20"));
    await logAt(new Date("2026-10-20T22:00:00Z"));
    assert.deepEqual(await storedStreak(), { current: 1, best: 1, lastLogDate: "2026-10-20" });
  });

  it("días consecutivos suman", async () => {
    for (const day of ["2026-10-20", "2026-10-21", "2026-10-22"]) await logAt(noonMvd(day));
    assert.deepEqual(await storedStreak(), { current: 3, best: 3, lastLogDate: "2026-10-22" });
  });

  it("saltear un día vuelve a 1 y la máxima se mantiene", async () => {
    for (const day of ["2026-10-20", "2026-10-21", "2026-10-22"]) await logAt(noonMvd(day));
    await logAt(noonMvd("2026-10-24"));
    assert.deepEqual(await storedStreak(), { current: 1, best: 3, lastLogDate: "2026-10-24" });
    await logAt(noonMvd("2026-10-25"));
    assert.deepEqual(await storedStreak(), { current: 2, best: 3, lastLogDate: "2026-10-25" });
  });

  it("una comida a las 23:30 de Montevideo cuenta para ese día, no para el siguiente", async () => {
    // 02:30 UTC del 7 son las 23:30 del 6 en Montevideo.
    await logAt(new Date("2026-10-07T02:30:00Z"));
    assert.deepEqual(await storedStreak(), { current: 1, best: 1, lastLogDate: "2026-10-06" });
    // El 7 al mediodía es el día siguiente: suma, no queda igual.
    await logAt(noonMvd("2026-10-07"));
    assert.deepEqual(await storedStreak(), { current: 2, best: 2, lastLogDate: "2026-10-07" });
  });

  it("el día anterior se calcula con el calendario en una zona con horario de verano", async () => {
    await setTimezone("America/New_York");
    // 8 de marzo de 2026, 00:30 EST (UTC-5): ese día se adelanta el reloj.
    await logAt(new Date("2026-03-08T05:30:00Z"));
    // 9 de marzo, 00:10 EDT (UTC-4): pasaron 22 h 40 min. Restando 24 h daría el 7 y cortaría la racha.
    await logAt(new Date("2026-03-09T04:10:00Z"));
    assert.deepEqual(await storedStreak(), { current: 2, best: 2, lastLogDate: "2026-03-09" });

    // Cuando se atrasa el reloj (1 de noviembre) el día dura 25 h y tampoco se saltea nada.
    await GamificationModel.deleteMany({});
    await logAt(new Date("2026-11-01T04:30:00Z")); // 1 de noviembre, 00:30 EDT
    await logAt(new Date("2026-11-03T04:50:00Z")); // 2 de noviembre, 23:50 EST
    assert.deepEqual(await storedStreak(), { current: 2, best: 2, lastLogDate: "2026-11-02" });
  });

  it("dos registros simultáneos el mismo día suman una sola vez", async () => {
    await logAt(noonMvd("2026-10-20"));
    clock = noonMvd("2026-10-21");
    await Promise.all(Array.from({ length: 5 }, () => postMeal()));
    assert.deepEqual(await storedStreak(), { current: 2, best: 2, lastLogDate: "2026-10-21" });
  });

  it("las primeras comidas a la vez crean un solo documento", async () => {
    clock = noonMvd("2026-10-20");
    await Promise.all(Array.from({ length: 5 }, () => postMeal()));
    assert.equal(await GamificationModel.countDocuments({ userId }), 1);
    assert.deepEqual(await storedStreak(), { current: 1, best: 1, lastLogDate: "2026-10-20" });
    assert.ok(!app.lines.some((l) => l.msg === "no se pudo actualizar la racha"));
  });

  it("un choque por la clave única se reintenta una vez", async () => {
    const streak = createStreakService();
    const original = GamificationModel.updateOne.bind(GamificationModel);
    let calls = 0;
    const updateOne = mock.method(
      GamificationModel,
      "updateOne",
      (...args: Parameters<typeof original>) => {
        calls++;
        if (calls === 1) {
          throw new mongoose.mongo.MongoServerError({
            message: "E11000 duplicate key",
            code: 11000,
          });
        }
        return original(...args);
      },
    );
    try {
      await streak.record(userId, "2026-10-20");
    } finally {
      updateOne.mock.restore();
    }
    assert.equal(calls, 2);
    assert.deepEqual(await storedStreak(), { current: 1, best: 1, lastLogDate: "2026-10-20" });
  });

  it("un localDate anterior al lastLogDate (cambio de zona) no toca nada", async () => {
    await logAt(noonMvd("2026-10-20"));
    await logAt(noonMvd("2026-10-21"));
    const streak = createStreakService();
    await streak.record(userId, "2026-10-20");
    assert.deepEqual(await storedStreak(), { current: 2, best: 2, lastLogDate: "2026-10-21" });
  });

  it("borrar una comida no cambia la racha", async () => {
    await logAt(noonMvd("2026-10-20"));
    const mealId = await logAt(noonMvd("2026-10-21"));
    await MealModel.deleteOne({ _id: mealId });
    assert.deepEqual(await storedStreak(), { current: 2, best: 2, lastLogDate: "2026-10-21" });
    // El día siguiente sigue sumando sobre la racha que ya estaba contada.
    await logAt(noonMvd("2026-10-22"));
    assert.deepEqual(await storedStreak(), { current: 3, best: 3, lastLogDate: "2026-10-22" });
  });

  describe("si la racha falla, la comida se registra igual", () => {
    it("si la actualización falla → 202 y se loguea el error con el requestId", async () => {
      const failing = await startApp({
        record: () => Promise.reject(new Error("mongo caído")),
        summary: () => Promise.reject(new Error("no se usa")),
      });
      try {
        clock = noonMvd("2026-10-20");
        const mealId = await postMeal(failing.url);
        assert.ok(await MealModel.exists({ _id: mealId }));
        const line = failing.lines.find((l) => l.msg === "no se pudo actualizar la racha");
        assert.ok(line);
        assert.equal(line.requestId, REQUEST_ID);
        assert.equal(line.mealId, mealId);
        assert.equal(line.level, "error");
      } finally {
        await failing.close();
      }
    });

    it("si la actualización tarda → 202 sin esperarla, con un warn", async () => {
      const slow = await startApp({
        record: () => new Promise<void>(() => {}),
        summary: () => Promise.reject(new Error("no se usa")),
      });
      try {
        clock = noonMvd("2026-10-20");
        const start = performance.now();
        await postMeal(slow.url);
        assert.ok(performance.now() - start < STREAK_TIMEOUT_MS + 500);
        const line = slow.lines.find((l) => l.msg === "la racha tarda; se responde sin esperarla");
        assert.equal(line?.requestId, REQUEST_ID);
      } finally {
        await slow.close();
      }
    });
  });

  describe("GET /dashboard/daily", () => {
    it("sin documento de gamification → 0 y 0", async () => {
      clock = noonMvd("2026-10-20");
      assert.deepEqual(await dashboardStreak(), { current: 0, best: 0 });
    });

    it("con registro hoy o ayer → la racha actual y la máxima", async () => {
      for (const day of ["2026-10-20", "2026-10-21"]) await logAt(noonMvd(day));
      assert.deepEqual(await dashboardStreak(), { current: 2, best: 2 });
      clock = noonMvd("2026-10-22");
      assert.deepEqual(await dashboardStreak(), { current: 2, best: 2 });
    });

    it("con el último registro hace dos días o más → current 0 y best tal cual", async () => {
      for (const day of ["2026-10-20", "2026-10-21"]) await logAt(noonMvd(day));
      clock = noonMvd("2026-10-23");
      assert.deepEqual(await dashboardStreak(), { current: 0, best: 2 });
      // La base no se toca: sigue la racha vieja hasta el próximo registro.
      assert.deepEqual(await storedStreak(), { current: 2, best: 2, lastLogDate: "2026-10-21" });
    });

    it("la racha es respecto de hoy aunque se pida otra fecha", async () => {
      for (const day of ["2026-10-20", "2026-10-21"]) await logAt(noonMvd(day));
      clock = noonMvd("2026-10-25");
      assert.deepEqual(await dashboardStreak("?date=2026-10-21"), { current: 0, best: 2 });
      clock = noonMvd("2026-10-21");
      assert.deepEqual(await dashboardStreak("?date=2026-10-01"), { current: 2, best: 2 });
    });

    it("hoy se calcula en la zona del usuario", async () => {
      await logAt(noonMvd("2026-10-20"));
      // 02:30 UTC del 22 son las 23:30 del 21 en Montevideo: el 20 todavía es ayer.
      clock = new Date("2026-10-22T02:30:00Z");
      assert.deepEqual(await dashboardStreak(), { current: 1, best: 1 });
    });
  });
});

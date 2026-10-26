import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, afterEach, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import { createApp } from "../src/app";
import { MealModel } from "../src/models/Meal";
import type { Correction, Meal, MealAnalysis, Range } from "../src/models/Meal";
import { UserModel } from "../src/models/User";
import type { Targets } from "../src/models/User";
import { apiRouter } from "../src/routes";
import { createAuthService } from "../src/services/auth";
import { createDashboardService, dailyTotalsPipeline } from "../src/services/dashboard";
import { applyCorrections } from "../src/services/meal-corrections";
import { signAccessToken } from "../src/services/tokens";
import { createUserService } from "../src/services/users";
import { captureLogger, listen } from "./helpers";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const REQUEST_ID = "0b6f3c1e-7d2a-4c5b-9e8f-1a2b3c4d5e6f";
const DAY = "2026-10-26";
// 01:30 UTC del 27 son las 22:30 del 26 en Montevideo (UTC-3).
const NOW = new Date("2026-10-27T01:30:00Z");
const profile = {
  sex: "female",
  birthDate: "2002-04-10",
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: "America/Montevideo",
} as const;
// Distintas de las que da la fórmula: el dashboard las devuelve tal cual, sin recalcular.
const targets: Targets = { kcal: 2100, proteinG: 120, carbsG: 240, fatG: 70 };

const r = (min: number, max: number): Range => ({ min, max });

function analysisOf(kcal: Range, protein: Range, carbs: Range, fat: Range): MealAnalysis {
  return {
    dish: "Plato",
    items: [{ name: "Plato", grams: r(100, 200), kcal }],
    kcal,
    macros: { protein, carbs, fat },
    confidence: 0.8,
    promptVersion: "v1",
    model: "modelo",
  };
}

const ZERO = { min: 0, max: 0, mid: 0 };
const ZEROS = { kcal: ZERO, protein: ZERO, carbs: ZERO, fat: ZERO };

type Envelope = { error: { code: string; message: string; requestId: string } };

describe("back-service: GET /dashboard/daily", () => {
  let mongo: MongoMemoryServer;
  let url: string;
  let close: () => Promise<void>;
  let userId: string;
  let otherUserId: string;
  let token: string;

  async function createMeal(fields: Partial<Meal> = {}, owner = userId) {
    const _id = new Types.ObjectId();
    await MealModel.create({
      _id,
      userId: owner,
      capturedAt: new Date("2026-10-26T15:00:00Z"),
      localDate: DAY,
      status: "processing",
      media: { photoKey: `users/${owner}/meals/${_id.toString()}/photo.jpg` },
      ...fields,
    });
    return _id.toString();
  }

  const ready = (analysis: MealAnalysis, fields: Partial<Meal> = {}) =>
    createMeal({ status: "ready", analysis, ...fields });

  const get = (query = "", auth: string | null = `Bearer ${token}`) =>
    fetch(`${url}/api/v1/dashboard/daily${query}`, {
      headers: { "x-request-id": REQUEST_ID, ...(auth && { authorization: auth }) },
    });

  async function dashboard(query = "") {
    const res = await get(query);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(res.status, 200, JSON.stringify(body));
    return body;
  }

  async function expectError(res: Response, status: number, code: string) {
    const body = (await res.json()) as Envelope;
    assert.equal(res.status, status, JSON.stringify(body));
    assert.equal(body.error.code, code);
    assert.equal(body.error.requestId, REQUEST_ID);
  }

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all([UserModel.init(), MealModel.init()]);
    const [user, other] = await UserModel.create([
      { email: "cami@example.com", passwordHash: "x", profile, targets },
      { email: "otra@example.com", passwordHash: "x", profile, targets },
    ]);
    userId = user.id as string;
    otherUserId = other.id as string;
    token = signAccessToken({ sub: userId, plan: "free" }, privateKey);

    const api = apiRouter({
      auth: createAuthService({ privateKey }),
      users: createUserService(),
      dashboard: createDashboardService({ now: () => NOW }),
      publicKey,
    });
    ({ url, close } = await listen(createApp({ logger: captureLogger("back").logger, api })));
  });

  afterEach(async () => {
    await MealModel.deleteMany({});
  });

  after(async () => {
    await close();
    await mongoose.disconnect();
    await mongo.stop();
  });

  it("varias comidas ready → suma de mínimos, de máximos y punto medio, con la forma de api.md", async () => {
    await ready(analysisOf(r(620, 780), r(38, 46), r(50, 65), r(28, 38)));
    await ready(analysisOf(r(430.4, 520.2), r(20.3, 30), r(60, 70.4), r(10, 12)));
    await ready(analysisOf(r(400, 520), r(22, 26), r(40, 55), r(7, 10)));

    const res = await get(`?date=${DAY}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), {
      date: DAY,
      consumed: {
        kcal: { min: 1450, max: 1820, mid: 1635 },
        protein: { min: 80, max: 102, mid: 91 },
        carbs: { min: 150, max: 190, mid: 170 },
        fat: { min: 45, max: 60, mid: 53 },
      },
      targets,
      meals: { ready: 3, processing: 0, failed: 0 },
    });
  });

  it("redondea en la respuesta, no antes de sumar", async () => {
    for (let i = 0; i < 3; i++) await ready(analysisOf(r(0.4, 0.4), r(0, 0), r(0, 0), r(0, 0)));
    const { consumed } = (await dashboard(`?date=${DAY}`)) as { consumed: { kcal: unknown } };
    assert.deepEqual(consumed.kcal, { min: 1, max: 1, mid: 1 });
  });

  it("las comidas en processing y failed no suman, pero se cuentan", async () => {
    await ready(analysisOf(r(500, 600), r(30, 40), r(50, 60), r(10, 20)));
    await createMeal();
    await createMeal();
    await createMeal({ status: "failed", error: { code: "NOT_FOOD" } });
    // Una failed con análisis tampoco suma.
    await createMeal({
      status: "failed",
      error: { code: "ANALYSIS_FAILED" },
      analysis: analysisOf(r(9000, 9000), r(900, 900), r(900, 900), r(900, 900)),
    });

    const body = await dashboard(`?date=${DAY}`);
    assert.deepEqual(body.consumed, {
      kcal: { min: 500, max: 600, mid: 550 },
      protein: { min: 30, max: 40, mid: 35 },
      carbs: { min: 50, max: 60, mid: 55 },
      fat: { min: 10, max: 20, mid: 15 },
    });
    assert.deepEqual(body.meals, { ready: 1, processing: 2, failed: 2 });
  });

  it("una comida corregida suma el valor corregido, la última corrección de cada campo gana", async () => {
    const original = analysisOf(r(620, 780), r(38, 46), r(50, 65), r(28, 38));
    const at = new Date("2026-10-26T16:00:00Z");
    const macros = { protein: r(40, 50), carbs: r(70, 80), fat: r(30, 40) };
    await ready(original, {
      corrections: [
        { field: "kcal", from: original.kcal, to: r(700, 800), at },
        { field: "dish", from: original.dish, to: "Milanesa napolitana", at },
        { field: "kcal", from: r(700, 800), to: r(800, 900), at },
        { field: "macros", from: original.macros, to: macros, at },
      ],
    });
    // Sin correcciones, para ver que suma las dos cosas bien.
    await ready(analysisOf(r(100, 200), r(10, 20), r(10, 20), r(5, 10)));

    const body = await dashboard(`?date=${DAY}`);
    assert.deepEqual(body.consumed, {
      kcal: { min: 900, max: 1100, mid: 1000 },
      protein: { min: 50, max: 70, mid: 60 },
      carbs: { min: 80, max: 100, mid: 90 },
      fat: { min: 35, max: 50, mid: 43 },
    });
  });

  it("una corrección inválida se ignora, igual que en applyCorrections", async () => {
    const original = analysisOf(r(600, 700), r(30, 40), r(50, 60), r(20, 30));
    const at = new Date("2026-10-26T16:00:00Z");
    const corrections: Correction[] = [
      { field: "kcal", from: original.kcal, to: r(650, 750), at },
      // Todas estas son inválidas: tiene que quedar la de arriba.
      { field: "kcal", from: null, to: r(900, 800), at },
      { field: "kcal", from: null, to: r(-10, 800), at },
      { field: "kcal", from: null, to: { min: "1", max: 2 }, at },
      { field: "kcal", from: null, to: r(10, Infinity), at },
      { field: "kcal", from: null, to: null, at },
      { field: "macros", from: null, to: { protein: r(1, 2), carbs: r(1, 2) }, at },
      { field: "macros", from: null, to: { protein: r(1, 2), carbs: r(1, 2), fat: r(3, 2) }, at },
      { field: "calorias", from: null, to: r(1, 2), at },
    ];
    await ready(original, { corrections });

    const expected = applyCorrections(original, corrections);
    assert.deepEqual(expected.kcal, r(650, 750));
    const body = (await dashboard(`?date=${DAY}`)) as {
      consumed: Record<string, { min: number; max: number }>;
    };
    assert.deepEqual(r(body.consumed.kcal.min, body.consumed.kcal.max), expected.kcal);
    for (const macro of ["protein", "carbs", "fat"] as const) {
      const { min, max } = body.consumed[macro];
      assert.deepEqual(r(min, max), expected.macros[macro], macro);
    }
  });

  it("sin date usa el día de hoy en la zona del usuario, aunque en UTC ya sea mañana", async () => {
    await ready(analysisOf(r(500, 600), r(30, 40), r(50, 60), r(10, 20)));
    await createMeal({ localDate: "2026-10-27" }); // el día UTC: no cuenta
    await ready(analysisOf(r(999, 999), r(9, 9), r(9, 9), r(9, 9)), { localDate: "2026-10-27" });

    const body = await dashboard();
    assert.equal(body.date, DAY);
    assert.deepEqual((body.consumed as { kcal: unknown }).kcal, { min: 500, max: 600, mid: 550 });
    assert.deepEqual(body.meals, { ready: 1, processing: 0, failed: 0 });
  });

  it("filtra por localDate, no por capturedAt", async () => {
    // Capturada el 27 en UTC, pero es del 26 para el usuario.
    await ready(analysisOf(r(500, 600), r(30, 40), r(50, 60), r(10, 20)), {
      capturedAt: new Date("2026-10-27T01:00:00Z"),
    });
    const body = await dashboard(`?date=${DAY}`);
    assert.deepEqual(body.meals, { ready: 1, processing: 0, failed: 0 });
    const next = await dashboard("?date=2026-10-27");
    assert.deepEqual(next.meals, { ready: 0, processing: 0, failed: 0 });
  });

  it("un día sin comidas → todo en cero, con la meta, no un 404", async () => {
    await ready(analysisOf(r(500, 600), r(30, 40), r(50, 60), r(10, 20)));
    assert.deepEqual(await dashboard("?date=2026-10-20"), {
      date: "2026-10-20",
      consumed: ZEROS,
      targets,
      meals: { ready: 0, processing: 0, failed: 0 },
    });
  });

  it("las comidas de otro usuario no se mezclan", async () => {
    await ready(analysisOf(r(500, 600), r(30, 40), r(50, 60), r(10, 20)));
    await createMeal({}, otherUserId);
    await createMeal(
      {
        status: "ready",
        analysis: analysisOf(r(9000, 9000), r(900, 900), r(900, 900), r(900, 900)),
      },
      otherUserId,
    );
    const body = await dashboard(`?date=${DAY}`);
    assert.deepEqual((body.consumed as { kcal: unknown }).kcal, { min: 500, max: 600, mid: 550 });
    assert.deepEqual(body.meals, { ready: 1, processing: 0, failed: 0 });
  });

  it("solo números: ningún campo que juzgue lo consumido (RNF-10)", async () => {
    await ready(analysisOf(r(5000, 6000), r(300, 400), r(500, 600), r(100, 200)));
    const body = await dashboard(`?date=${DAY}`);
    assert.deepEqual(Object.keys(body), ["date", "consumed", "targets", "meals"]);
    const leaves = JSON.stringify(body.consumed) + JSON.stringify(body.targets);
    assert.ok(!/"[^"]*":\s*"/.test(leaves), "hay un valor que no es un número");
  });

  for (const [caso, query] of [
    ["con otro formato", "?date=26-10-2026"],
    ["sin ceros a la izquierda", "?date=2026-1-5"],
    ["un día que no existe", "?date=2026-02-30"],
    ["un mes que no existe", "?date=2026-13-01"],
    ["con hora", "?date=2026-10-26T00:00:00Z"],
    ["vacía", "?date="],
    ["repetida", `?date=${DAY}&date=${DAY}`],
    ["con un operador", "?date[$gt]="],
    ["un campo de más", `?date=${DAY}&userId=66f1a0000000000000000001`],
  ] as const) {
    it(`fecha inválida (${caso}) → 400 VALIDATION_ERROR`, async () => {
      await expectError(await get(query), 400, "VALIDATION_ERROR");
    });
  }

  it("sin token → 401 UNAUTHORIZED", async () => {
    await expectError(await get("", null), 401, "UNAUTHORIZED");
  });

  it("con un token inválido → 401 UNAUTHORIZED", async () => {
    await expectError(await get("", "Bearer no.es.unjwt"), 401, "UNAUTHORIZED");
  });

  it("un token válido de una cuenta que ya no existe → 401 UNAUTHORIZED", async () => {
    const ghost = signAccessToken(
      { sub: new Types.ObjectId().toString(), plan: "free" },
      privateKey,
    );
    await expectError(await get(`?date=${DAY}`, `Bearer ${ghost}`), 401, "UNAUTHORIZED");
  });

  describe("rendimiento (RNF-01)", () => {
    /** 60 días hasta DAY con 8 comidas ready cada uno: 480 comidas del usuario. */
    async function seedDays() {
      const analysis = analysisOf(r(500, 600), r(30, 40), r(50, 60), r(10, 20));
      const days = Array.from({ length: 60 }, (_, i) =>
        new Date(Date.UTC(2026, 7, 28 + i)).toISOString().slice(0, 10),
      );
      await MealModel.insertMany(
        days.flatMap((localDate) =>
          Array.from({ length: 8 }, () => ({
            userId,
            capturedAt: new Date(`${localDate}T15:00:00Z`),
            localDate,
            status: "ready",
            media: { photoKey: "x" },
            analysis,
          })),
        ),
      );
    }

    /** El plan elegido; `explain` también lista los rechazados, que no cuentan. */
    function winningPlan(explain: unknown): unknown {
      if (typeof explain !== "object" || explain === null) return undefined;
      if ("winningPlan" in explain) return explain.winningPlan;
      for (const value of Object.values(explain)) {
        const found = winningPlan(value);
        if (found) return found;
      }
      return undefined;
    }

    it("la agregación usa el índice { userId, localDate }", async () => {
      await seedDays();
      const explain = await MealModel.aggregate(dailyTotalsPipeline(userId, DAY)).explain();
      const plan = JSON.stringify(winningPlan(explain));
      assert.match(plan, /"indexName":"userId_1_localDate_1"/);
      assert.doesNotMatch(plan, /COLLSCAN/);
    });

    it("con muchas comidas en la base responde en menos de 1 s", async () => {
      await seedDays();
      const start = performance.now();
      const body = await dashboard(`?date=${DAY}`);
      assert.ok(performance.now() - start < 1000);
      assert.deepEqual(body.meals, { ready: 8, processing: 0, failed: 0 });
      assert.deepEqual((body.consumed as { kcal: unknown }).kcal, {
        min: 4000,
        max: 4800,
        mid: 4400,
      });
    });
  });
});

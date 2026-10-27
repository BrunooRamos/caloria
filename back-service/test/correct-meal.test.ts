import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, afterEach, before, describe, it } from "node:test";
import type { TestContext } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import { loadStorageConfig } from "../src/config/storage";
import { createApp } from "../src/app";
import type { MealAnalysisQueue } from "../src/jobs/meal-analysis";
import { MealModel } from "../src/models/Meal";
import type { Correction, Meal, MealAnalysis, Range } from "../src/models/Meal";
import { UserModel } from "../src/models/User";
import { apiRouter } from "../src/routes";
import { createAuthService } from "../src/services/auth";
import { createDashboardService } from "../src/services/dashboard";
import { createMealService } from "../src/services/meals";
import { createMediaService } from "../src/services/media";
import { computeTargets } from "../src/services/targets";
import { signAccessToken } from "../src/services/tokens";
import { createUserService } from "../src/services/users";
import { captureLogger, listen, storageEnv } from "./helpers";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const REQUEST_ID = "0b6f3c1e-7d2a-4c5b-9e8f-1a2b3c4d5e6f";
const DAY = "2026-10-06";
const NOW = new Date("2026-10-06T15:00:00Z");
const profile = {
  sex: "female",
  birthDate: "2002-04-10",
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: "America/Montevideo",
} as const;

const r = (min: number, max: number): Range => ({ min, max });

const analysis: MealAnalysis = {
  dish: "Milanesa con puré",
  items: [{ name: "Milanesa", grams: r(150, 190), kcal: r(380, 470) }],
  kcal: r(620, 780),
  macros: { protein: r(38, 46), carbs: r(50, 65), fat: r(28, 38) },
  confidence: 0.72,
  promptVersion: "v1-secreto",
  model: "modelo-secreto",
};

const queue: MealAnalysisQueue = {
  async enqueue() {},
  async ready() {},
  async close() {},
};

type Envelope = { error: { code: string; message: string; requestId: string } };
type Body = Record<string, unknown>;

describe("back-service: PATCH /meals/:id", () => {
  let mongo: MongoMemoryServer;
  let url: string;
  let close: () => Promise<void>;
  let userId: string;
  let otherUserId: string;
  let token: string;
  let lines: Record<string, unknown>[];

  async function createMeal(fields: Partial<Meal> = {}, owner = userId) {
    const _id = new Types.ObjectId();
    await MealModel.create({
      _id,
      userId: owner,
      capturedAt: new Date("2026-10-06T13:05:00Z"),
      localDate: DAY,
      status: "ready",
      analysis,
      media: {
        photoKey: `users/${owner}/meals/${_id.toString()}/photo.jpg`,
        audioKey: `users/${owner}/meals/${_id.toString()}/audio.m4a`,
      },
      transcript: "transcripcion-secreta",
      note: "nota-secreta",
      attempts: 2,
      ...fields,
    });
    return _id.toString();
  }

  const patch = (id: string, body: unknown, auth: string | null = `Bearer ${token}`) =>
    fetch(`${url}/api/v1/meals/${id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-request-id": REQUEST_ID,
        ...(auth && { authorization: auth }),
      },
      body: JSON.stringify(body),
    });

  async function correct(id: string, body: unknown) {
    const res = await patch(id, body);
    const json = (await res.json()) as Body;
    assert.equal(res.status, 200, JSON.stringify(json));
    return { res, body: json };
  }

  async function expectError(res: Response, status: number, code: string) {
    const body = (await res.json()) as Envelope;
    assert.equal(res.status, status, JSON.stringify(body));
    assert.equal(body.error.code, code);
    assert.equal(body.error.requestId, REQUEST_ID);
    return body;
  }

  const stored = async (id: string) => {
    const meal = await MealModel.findById(id).lean<Meal>();
    assert.ok(meal);
    return meal;
  };

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all([UserModel.init(), MealModel.init()]);
    const targets = computeTargets(profile);
    const [user, other] = await UserModel.create([
      { email: "cami@example.com", passwordHash: "x", profile, targets },
      { email: "otra@example.com", passwordHash: "x", profile, targets },
    ]);
    userId = user.id as string;
    otherUserId = other.id as string;
    token = signAccessToken({ sub: userId, plan: "free" }, privateKey);

    const capture = captureLogger("back");
    lines = capture.lines;
    const api = apiRouter({
      auth: createAuthService({ privateKey }),
      users: createUserService(),
      meals: createMealService({
        media: createMediaService(loadStorageConfig(storageEnv)),
        queue,
        now: () => NOW,
      }),
      dashboard: createDashboardService({ now: () => NOW }),
      publicKey,
    });
    ({ url, close } = await listen(createApp({ logger: capture.logger, api })));
  });

  afterEach(async () => {
    await MealModel.deleteMany({});
    lines.length = 0;
  });

  after(async () => {
    await close();
    await mongoose.disconnect();
    await mongo.stop();
  });

  it("corrige plato y kcal: dos correcciones con from/to/at, analysis intacto y la respuesta corregida", async () => {
    const id = await createMeal();
    const { res, body } = await correct(id, {
      dish: "  Milanesa napolitana con puré ",
      kcal: r(800, 900),
    });

    assert.equal(res.headers.get("cache-control"), "no-store");
    const { photoUrl, ...rest } = body;
    assert.equal(typeof photoUrl, "string");
    assert.deepEqual(rest, {
      id,
      status: "ready",
      capturedAt: "2026-10-06T13:05:00.000Z",
      dish: "Milanesa napolitana con puré",
      items: analysis.items,
      kcal: r(800, 900),
      macros: analysis.macros,
      confidence: 0.72,
    });

    const meal = await stored(id);
    assert.deepEqual(meal.corrections, [
      { field: "dish", from: analysis.dish, to: "Milanesa napolitana con puré", at: NOW },
      { field: "kcal", from: analysis.kcal, to: r(800, 900), at: NOW },
    ]);
    assert.deepEqual(meal.analysis, analysis);

    // Lo que se corrigió, sin los valores.
    const line = lines.find((l) => l.msg === "comida corregida");
    assert.ok(line, "no logueó la corrección");
    assert.equal(line.mealId, id);
    assert.deepEqual(line.fields, ["dish", "kcal"]);
    assert.equal(typeof line.durationMs, "number");
    const text = JSON.stringify(line);
    for (const value of ["napolitana", "Milanesa con puré", "800", "620"]) {
      assert.ok(!text.includes(value), `el log incluye ${value}`);
    }
  });

  it("un segundo PATCH del mismo campo encadena: el from es la corrección anterior y gana la última", async () => {
    const id = await createMeal();
    await correct(id, { kcal: r(800, 900) });
    const { body } = await correct(id, { kcal: r(700, 750) });
    assert.deepEqual(body.kcal, r(700, 750));

    const { corrections } = await stored(id);
    assert.deepEqual(
      corrections.map(({ field, from, to }) => ({ field, from, to })),
      [
        { field: "kcal", from: analysis.kcal, to: r(800, 900) },
        { field: "kcal", from: r(800, 900), to: r(700, 750) },
      ],
    );
  });

  it("un campo igual al valor actual no se registra", async () => {
    const id = await createMeal();
    // Mismos valores con otro orden de claves: igual no cambió nada.
    const { body } = await correct(id, {
      dish: "Otra cosa",
      macros: { fat: r(28, 38), carbs: r(50, 65), protein: { max: 46, min: 38 } },
      items: analysis.items,
    });
    assert.equal(body.dish, "Otra cosa");
    const { corrections } = await stored(id);
    assert.deepEqual(
      corrections.map(({ field }) => field),
      ["dish"],
    );
    const line = lines.find((l) => l.msg === "comida corregida");
    assert.deepEqual(line?.fields, ["dish"]);
  });

  it("igual al valor corregido (no al del análisis) tampoco se registra", async () => {
    const id = await createMeal();
    await correct(id, { kcal: r(800, 900) });
    await correct(id, { kcal: r(800, 900) });
    assert.equal((await stored(id)).corrections.length, 1);
  });

  it("si no cambió nada → 200 con la comida y sin tocar la base", async () => {
    const id = await createMeal();
    const before = await stored(id);
    const { body } = await correct(id, { dish: analysis.dish, kcal: analysis.kcal });
    assert.equal(body.dish, analysis.dish);
    assert.deepEqual(await stored(id), before);
    assert.deepEqual(lines.find((l) => l.msg === "comida corregida")?.fields, []);
  });

  it("items y macros se guardan completos, tal cual los manda el usuario", async () => {
    const id = await createMeal();
    const items = [
      { name: "Milanesa napolitana", grams: r(200, 240), kcal: r(520, 610) },
      { name: "Puré", grams: r(150, 200), kcal: r(150, 200) },
    ];
    const macros = { protein: r(40, 50), carbs: r(60, 80), fat: r(30, 40) };
    const { body } = await correct(id, { items, macros });
    assert.deepEqual(body.items, items);
    assert.deepEqual(body.macros, macros);
    // No se recalcula el total desde los ingredientes.
    assert.deepEqual(body.kcal, analysis.kcal);

    const { corrections, analysis: kept } = await stored(id);
    assert.deepEqual(
      corrections.map(({ field, from, to }) => ({ field, from, to })),
      [
        { field: "items", from: analysis.items, to: items },
        { field: "macros", from: analysis.macros, to: macros },
      ],
    );
    assert.deepEqual(kept, analysis);
  });

  it("una lista de ingredientes vacía es una corrección válida", async () => {
    const id = await createMeal();
    const { body } = await correct(id, { items: [] });
    assert.deepEqual(body.items, []);
  });

  it("dos PATCH concurrentes: ninguno pisa al otro y los from encadenan", async () => {
    const id = await createMeal();
    const [a, b] = await Promise.all([
      patch(id, { kcal: r(800, 900) }),
      patch(id, { kcal: r(700, 750) }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);

    const { corrections } = await stored(id);
    assert.equal(corrections.length, 2);
    assert.deepEqual(corrections[0].from, analysis.kcal);
    assert.deepEqual(corrections[1].from, corrections[0].to);
    assert.deepEqual(
      new Set(corrections.map(({ to }) => JSON.stringify(to))),
      new Set([JSON.stringify(r(800, 900)), JSON.stringify(r(700, 750))]),
    );
    // La comida queda con el último que se escribió.
    const final = (await (await patch(id, { dish: analysis.dish })).json()) as Body;
    assert.deepEqual(final.kcal, corrections[1].to);
  });

  describe("conflicto forzado entre la lectura y la escritura", () => {
    const concurrent = (at: Date): Correction => ({
      field: "kcal",
      from: analysis.kcal,
      to: r(1000, 1100),
      at,
    });

    /** Antes de cada escritura del PATCH, otro request agrega una corrección. */
    function interfere(t: TestContext, id: string, times: number) {
      const original = MealModel.findOneAndUpdate.bind(MealModel);
      let calls = 0;
      const fake = (...args: Parameters<typeof original>) => ({
        lean: async () => {
          if (calls++ < times) {
            await MealModel.updateOne(
              { _id: id },
              { $push: { corrections: concurrent(new Date()) } },
            );
          }
          return original(...args).lean();
        },
      });
      t.mock.method(MealModel, "findOneAndUpdate", fake as never);
    }

    it("relee y reintenta: el from es el valor que dejó el otro PATCH", async (t) => {
      const id = await createMeal();
      interfere(t, id, 1);
      const { body } = await correct(id, { kcal: r(800, 900) });
      assert.deepEqual(body.kcal, r(800, 900));

      const { corrections } = await stored(id);
      assert.deepEqual(
        corrections.map(({ from, to }) => ({ from, to })),
        [
          { from: analysis.kcal, to: r(1000, 1100) },
          { from: r(1000, 1100), to: r(800, 900) },
        ],
      );
    });

    it("si pierde todos los reintentos → 500 INTERNAL_ERROR sin escribir un from viejo", async (t) => {
      const id = await createMeal();
      interfere(t, id, Infinity);
      await expectError(await patch(id, { kcal: r(800, 900) }), 500, "INTERNAL_ERROR");
      const { corrections } = await stored(id);
      assert.ok(corrections.length > 0);
      assert.ok(
        corrections.every(({ to }) => JSON.stringify(to) === JSON.stringify(r(1000, 1100))),
      );
    });
  });

  it("la respuesta no expone campos internos ni el historial de correcciones", async () => {
    const id = await createMeal({ comment: { tone: "neutro", text: "ok" } });
    await correct(id, { dish: "Primera" });
    const { body } = await correct(id, { dish: "Segunda" });
    assert.deepEqual(Object.keys(body).sort(), [
      "capturedAt",
      "comment",
      "confidence",
      "dish",
      "id",
      "items",
      "kcal",
      "macros",
      "photoUrl",
      "status",
    ]);
    const { photoUrl, ...rest } = body;
    assert.ok(!String(photoUrl).includes("audio.m4a"));
    const text = JSON.stringify(rest);
    for (const secret of [
      userId,
      "audio.m4a",
      "v1-secreto",
      "modelo-secreto",
      "transcripcion-secreta",
      "nota-secreta",
      "attempts",
      "corrections",
      "Primera",
      "Milanesa con puré",
      "_id",
      "__v",
    ]) {
      assert.ok(!text.includes(secret), `la respuesta incluye ${secret}`);
    }
  });

  describe("404", () => {
    it("una comida de otro usuario y un id inexistente responden igual, sin tocar la base", async () => {
      const othersMeal = await createMeal({}, otherUserId);
      const missing = new Types.ObjectId().toString();
      const body = { kcal: r(1, 2) };

      const responses = await Promise.all(
        [othersMeal, missing].map(async (id) => {
          const res = await patch(id, body);
          return {
            status: res.status,
            contentType: res.headers.get("content-type"),
            body: await res.text(),
          };
        }),
      );
      assert.equal(responses[0].status, 404);
      assert.deepEqual(responses[0], responses[1]);
      const { error } = JSON.parse(responses[0].body) as Envelope;
      assert.equal(error.code, "NOT_FOUND");
      assert.equal(error.requestId, REQUEST_ID);
      assert.deepEqual((await stored(othersMeal)).corrections, []);
    });
  });

  for (const [caso, id] of [
    ["muy corto", "123"],
    ["con caracteres que no son hex", "66f1a000000000000000009z"],
    ["de 12 caracteres (Mongoose lo aceptaría)", "aaaaaaaaaaaa"],
    ["con un operador", encodeURIComponent('{"$gt":""}')],
  ] as const) {
    it(`id ${caso} → 400 VALIDATION_ERROR`, async () => {
      await expectError(await patch(id, { kcal: r(1, 2) }), 400, "VALIDATION_ERROR");
    });
  }

  for (const [caso, body] of [
    ["body vacío", {}],
    ["un campo desconocido", { dish: "Milanesa", status: "failed" }],
    ["analysis en el body", { analysis: { dish: "x" } }],
    ["kcal con min > max", { kcal: r(900, 800) }],
    ["kcal negativas", { kcal: r(-10, 800) }],
    ["un macro con min > max", { macros: { ...analysis.macros, fat: r(40, 30) } }],
    [
      "un ingrediente con gramos negativos",
      { items: [{ name: "x", grams: r(-1, 2), kcal: r(1, 2) }] },
    ],
    ["un plato vacío", { dish: " " }],
    ["un array", [{ dish: "x" }]],
  ] as const) {
    it(`${caso} → 400 VALIDATION_ERROR sin tocar la base`, async () => {
      const id = await createMeal();
      const before = await stored(id);
      await expectError(await patch(id, body), 400, "VALIDATION_ERROR");
      assert.deepEqual(await stored(id), before);
    });
  }

  for (const status of ["processing", "failed"] as const) {
    it(`comida en ${status} → 409 MEAL_NOT_READY sin tocar la base`, async () => {
      const id = await createMeal({
        status,
        analysis: undefined,
        ...(status === "failed" && { error: { code: "NOT_FOOD" as const } }),
      });
      const before = await stored(id);
      const body = await expectError(await patch(id, { kcal: r(1, 2) }), 409, "MEAL_NOT_READY");
      assert.equal(body.error.message, "La comida no tiene un análisis para corregir");
      assert.deepEqual(await stored(id), before);
    });
  }

  it("sin token → 401 UNAUTHORIZED", async () => {
    const id = await createMeal();
    await expectError(await patch(id, { kcal: r(1, 2) }, null), 401, "UNAUTHORIZED");
    assert.deepEqual((await stored(id)).corrections, []);
  });

  it("con un token inválido → 401 UNAUTHORIZED", async () => {
    const id = await createMeal();
    await expectError(
      await patch(id, { kcal: r(1, 2) }, "Bearer no.es.unjwt"),
      401,
      "UNAUTHORIZED",
    );
    assert.deepEqual((await stored(id)).corrections, []);
  });

  it("de punta a punta: lo que corrige el PATCH es lo que suma GET /dashboard/daily", async () => {
    const id = await createMeal();
    await createMeal({
      analysis: {
        ...analysis,
        kcal: r(400, 500),
        macros: { ...analysis.macros, protein: r(20, 30) },
      },
    });
    await correct(id, { kcal: r(800, 900), macros: { ...analysis.macros, protein: r(50, 60) } });

    const res = await fetch(`${url}/api/v1/dashboard/daily?date=${DAY}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const { consumed } = (await res.json()) as { consumed: Record<string, unknown> };
    assert.deepEqual(consumed.kcal, { min: 1200, max: 1400, mid: 1300 });
    assert.deepEqual(consumed.protein, { min: 70, max: 90, mid: 80 });
  });
});

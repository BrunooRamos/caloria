import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, afterEach, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import { loadStorageConfig } from "../src/config/storage";
import { createApp } from "../src/app";
import type { MealAnalysisQueue } from "../src/jobs/meal-analysis";
import { MealModel } from "../src/models/Meal";
import type { Meal, MealAnalysis } from "../src/models/Meal";
import { UserModel } from "../src/models/User";
import { apiRouter } from "../src/routes";
import { createAuthService } from "../src/services/auth";
import { createMealService } from "../src/services/meals";
import { createMediaService, MAX_SIGNED_URL_TTL_SECONDS } from "../src/services/media";
import { computeTargets } from "../src/services/targets";
import { signAccessToken } from "../src/services/tokens";
import { createUserService } from "../src/services/users";
import { captureLogger, listen, storageEnv } from "./helpers";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const REQUEST_ID = "0b6f3c1e-7d2a-4c5b-9e8f-1a2b3c4d5e6f";
const CAPTURED_AT = new Date("2026-10-06T13:05:00Z");
const profile = {
  sex: "female",
  birthDate: "2002-04-10",
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: "America/Montevideo",
} as const;

const analysis: MealAnalysis = {
  dish: "Milanesa con puré",
  items: [{ name: "Milanesa", grams: { min: 150, max: 190 }, kcal: { min: 380, max: 470 } }],
  kcal: { min: 620, max: 780 },
  macros: {
    protein: { min: 38, max: 46 },
    carbs: { min: 50, max: 65 },
    fat: { min: 28, max: 38 },
  },
  confidence: 0.72,
  promptVersion: "v1-secreto",
  model: "modelo-secreto",
};

// Valores llamativos en los campos internos, para buscarlos en la respuesta.
const INTERNAL = {
  transcript: "transcripcion-secreta",
  note: "nota-secreta",
  attempts: 3,
};

const queue: MealAnalysisQueue = {
  async enqueue() {},
  async ready() {},
  async close() {},
};

type Envelope = { error: { code: string; message: string; requestId: string } };

describe("back-service: GET /meals/:id", () => {
  let mongo: MongoMemoryServer;
  let url: string;
  let close: () => Promise<void>;
  let userId: string;
  let otherUserId: string;
  let token: string;
  let lines: Record<string, unknown>[];

  /** Crea una comida del usuario (o de `owner`) con todos los campos internos llenos. */
  async function createMeal(fields: Partial<Meal> = {}, owner = userId) {
    const _id = new Types.ObjectId();
    await MealModel.create({
      _id,
      userId: owner,
      capturedAt: CAPTURED_AT,
      localDate: "2026-10-06",
      status: "processing",
      media: {
        photoKey: `users/${owner}/meals/${_id.toString()}/photo.jpg`,
        audioKey: `users/${owner}/meals/${_id.toString()}/audio.m4a`,
      },
      ...INTERNAL,
      ...fields,
    });
    return _id.toString();
  }

  const get = (id: string, auth: string | null = `Bearer ${token}`) =>
    fetch(`${url}/api/v1/meals/${id}`, {
      headers: { "x-request-id": REQUEST_ID, ...(auth && { authorization: auth }) },
    });

  async function expectError(res: Response, status: number, code: string) {
    const body = (await res.json()) as Envelope;
    assert.equal(res.status, status, JSON.stringify(body));
    assert.equal(body.error.code, code);
    assert.equal(body.error.requestId, REQUEST_ID);
    return body;
  }

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all([UserModel.init(), MealModel.init()]);
    const [user, other] = await UserModel.create([
      { email: "cami@example.com", passwordHash: "x", profile, targets: computeTargets(profile) },
      { email: "otra@example.com", passwordHash: "x", profile, targets: computeTargets(profile) },
    ]);
    userId = user.id as string;
    otherUserId = other.id as string;
    token = signAccessToken({ sub: userId, plan: "free" }, privateKey);

    const capture = captureLogger("back");
    lines = capture.lines;
    const meals = createMealService({
      media: createMediaService(loadStorageConfig(storageEnv)),
      queue,
    });
    const api = apiRouter({
      auth: createAuthService({ privateKey }),
      users: createUserService(),
      meals,
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

  describe("forma de la respuesta según el status", () => {
    it("processing → solo id, status, capturedAt y photoUrl, sin caché", async () => {
      const id = await createMeal();
      const res = await get(id);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("cache-control"), "no-store");
      const body = (await res.json()) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body), ["id", "status", "capturedAt", "photoUrl"]);
      assert.equal(body.id, id);
      assert.equal(body.status, "processing");
      assert.equal(body.capturedAt, "2026-10-06T13:05:00.000Z");
      assert.equal(typeof body.photoUrl, "string");
    });

    it("ready → análisis en rangos, confianza y comentario, con la forma de api.md", async () => {
      const comment = { tone: "roast", text: "Eso no es una porción, es una mudanza." };
      const id = await createMeal({ status: "ready", analysis, comment });
      const res = await get(id);
      assert.equal(res.status, 200);
      const { photoUrl, ...body } = (await res.json()) as Record<string, unknown>;
      assert.equal(typeof photoUrl, "string");
      assert.deepEqual(body, {
        id,
        status: "ready",
        capturedAt: "2026-10-06T13:05:00.000Z",
        dish: "Milanesa con puré",
        items: [{ name: "Milanesa", grams: { min: 150, max: 190 }, kcal: { min: 380, max: 470 } }],
        kcal: { min: 620, max: 780 },
        macros: {
          protein: { min: 38, max: 46 },
          carbs: { min: 50, max: 65 },
          fat: { min: 28, max: 38 },
        },
        confidence: 0.72,
        comment,
      });
    });

    it("ready sin comentario (tono desactivado) → el campo comment no viene", async () => {
      const id = await createMeal({ status: "ready", analysis });
      const body = (await (await get(id)).json()) as Record<string, unknown>;
      assert.equal(body.status, "ready");
      assert.equal(Object.hasOwn(body, "comment"), false);
    });

    for (const code of ["NOT_FOOD", "ENQUEUE_FAILED", "ANALYSIS_FAILED"] as const) {
      it(`failed (${code}) → error.code, sin análisis`, async () => {
        const id = await createMeal({ status: "failed", error: { code } });
        const res = await get(id);
        assert.equal(res.status, 200);
        const { photoUrl, ...body } = (await res.json()) as Record<string, unknown>;
        assert.equal(typeof photoUrl, "string");
        assert.deepEqual(body, {
          id,
          status: "failed",
          capturedAt: "2026-10-06T13:05:00.000Z",
          error: { code },
        });
      });
    }
  });

  it("ready con correcciones → los valores corregidos, la última de cada campo gana", async () => {
    const items = [
      { name: "Milanesa napolitana", grams: { min: 200, max: 240 }, kcal: { min: 520, max: 610 } },
      { name: "Puré", grams: { min: 150, max: 200 }, kcal: { min: 150, max: 200 } },
    ];
    const at = new Date("2026-10-06T14:00:00Z");
    const id = await createMeal({
      status: "ready",
      analysis,
      corrections: [
        { field: "dish", from: analysis.dish, to: "Milanesa napolitana", at },
        { field: "kcal", from: analysis.kcal, to: { min: 800, max: 900 }, at },
        { field: "items", from: analysis.items, to: items, at },
        { field: "dish", from: "Milanesa napolitana", to: "Milanesa napolitana con puré", at },
      ],
    });
    const body = (await (await get(id)).json()) as Record<string, unknown>;
    assert.equal(body.dish, "Milanesa napolitana con puré");
    assert.deepEqual(body.kcal, { min: 800, max: 900 });
    assert.deepEqual(body.items, items);
    // Lo que no se corrigió queda como lo dejó la IA.
    assert.deepEqual(body.macros, analysis.macros);
    assert.equal(body.confidence, analysis.confidence);
    assert.equal(Object.hasOwn(body, "corrections"), false);

    // El análisis guardado no se toca: las correcciones se aplican al leer.
    const stored = await MealModel.findById(id).lean<Meal>();
    assert.equal(stored?.analysis?.dish, analysis.dish);
  });

  it("no expone ningún campo interno en ningún status", async () => {
    const at = new Date("2026-10-06T14:00:00Z");
    const correction = { field: "dish", from: "correccion-from", to: "Milanesa", at };
    const ids = [
      await createMeal(),
      await createMeal({
        status: "ready",
        analysis,
        corrections: [correction],
        comment: { tone: "neutro", text: "ok" },
      }),
      await createMeal({ status: "failed", error: { code: "NOT_FOOD" } }),
    ];
    const allowed = new Set([
      "id",
      "status",
      "capturedAt",
      "photoUrl",
      "dish",
      "items",
      "kcal",
      "macros",
      "confidence",
      "comment",
      "error",
    ]);
    for (const id of ids) {
      const body = (await (await get(id)).json()) as Record<string, unknown>;
      for (const key of Object.keys(body)) assert.ok(allowed.has(key), `salió ${key}`);
      // La URL firmada lleva la key de la foto en el path (es la del propio usuario); el resto no.
      const { photoUrl, ...rest } = body;
      assert.ok(!String(photoUrl).includes("audio.m4a"));
      const text = JSON.stringify(rest);
      for (const secret of [
        userId,
        "audio.m4a",
        "v1-secreto",
        "modelo-secreto",
        INTERNAL.transcript,
        INTERNAL.note,
        "attempts",
        "correccion-from",
        "_id",
        "__v",
      ]) {
        assert.ok(!text.includes(secret), `la respuesta incluye ${secret}`);
      }
    }
  });

  describe("404", () => {
    it("una comida de otro usuario y un id inexistente responden exactamente igual", async () => {
      const othersMeal = await createMeal({ status: "ready", analysis }, otherUserId);
      const missing = new Types.ObjectId().toString();

      const [others, inexistent] = await Promise.all([get(othersMeal), get(missing)]);
      const responses = await Promise.all(
        [others, inexistent].map(async (res) => ({
          status: res.status,
          contentType: res.headers.get("content-type"),
          cacheControl: res.headers.get("cache-control"),
          body: await res.text(),
        })),
      );
      assert.equal(responses[0].status, 404);
      assert.deepEqual(responses[0], responses[1]);
      const { error } = JSON.parse(responses[0].body) as Envelope;
      assert.equal(error.code, "NOT_FOUND");
      assert.equal(error.requestId, REQUEST_ID);
    });
  });

  for (const [caso, id] of [
    ["muy corto", "123"],
    ["con caracteres que no son hex", "66f1a000000000000000009z"],
    ["de 12 caracteres (Mongoose lo aceptaría)", "aaaaaaaaaaaa"],
    ["con un operador", encodeURIComponent('{"$gt":""}')],
  ] as const) {
    it(`id ${caso} → 400 VALIDATION_ERROR, nunca un 500`, async () => {
      await expectError(await get(id), 400, "VALIDATION_ERROR");
      assert.ok(!lines.some((line) => line.level === "error"), "logueó un error");
    });
  }

  it("photoUrl firmada con el endpoint público, para la key de la foto y vida de 15 min", async () => {
    const id = await createMeal();
    const before = Date.now();
    const { photoUrl } = (await (await get(id)).json()) as { photoUrl: string };
    const signed = new URL(photoUrl);

    assert.equal(signed.origin, storageEnv.S3_PUBLIC_ENDPOINT);
    assert.equal(signed.pathname, `/${storageEnv.S3_BUCKET}/users/${userId}/meals/${id}/photo.jpg`);
    assert.equal(signed.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
    assert.equal(signed.searchParams.get("X-Amz-Expires"), String(MAX_SIGNED_URL_TTL_SECONDS));
    assert.equal(MAX_SIGNED_URL_TTL_SECONDS, 15 * 60);
    assert.match(signed.searchParams.get("X-Amz-Signature") ?? "", /^[0-9a-f]{64}$/);
    // Firmada en esta request, no reutilizada de antes.
    const amzDate = signed.searchParams.get("X-Amz-Date") ?? "";
    const signedAt = Date.parse(
      amzDate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"),
    );
    assert.ok(signedAt >= Math.floor(before / 1000) * 1000, "se firmó antes de la request");

    // Nunca se guarda en la base.
    const stored = JSON.stringify(await MealModel.findById(id).lean());
    assert.ok(!stored.includes("X-Amz"), "guardó una URL firmada");
  });

  it("sin token → 401 UNAUTHORIZED", async () => {
    const id = await createMeal();
    await expectError(await get(id, null), 401, "UNAUTHORIZED");
  });

  it("con un token inválido → 401 UNAUTHORIZED", async () => {
    const id = await createMeal();
    await expectError(await get(id, "Bearer no.es.unjwt"), 401, "UNAUTHORIZED");
  });

  it("un documento inconsistente (ready sin análisis) → 500 INTERNAL_ERROR sin detalles", async () => {
    const id = await createMeal({ status: "ready" });
    const body = await expectError(await get(id), 500, "INTERNAL_ERROR");
    assert.ok(!JSON.stringify(body).includes("análisis"));
  });
});

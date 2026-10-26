import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { ANALYSIS_PROMPT_PATH, loadAnalysisPrompt } from "../src/config/analysis-prompt";
import { loadWorkerConfig } from "../src/config/worker";
import { createAnalyzeMeal, NOT_FOOD } from "../src/jobs/analyze-meal";
import { createMealAnalysisProcessor } from "../src/jobs/meal-analysis-processor";
import { createMealAnalysisHandler } from "../src/jobs/meal-analysis-worker";
import { MealModel } from "../src/models/Meal";
import type { MediaService } from "../src/services/media";
import {
  createOpenAiVision,
  InvalidVisionResponseError,
  parseVisionResponse,
} from "../src/services/vision";
import type { VisionService } from "../src/services/vision";
import { toVisionImage } from "../src/services/vision-image";
import type { VisionImage } from "../src/services/vision-image";
import { captureLogger, fixtures, storageEnv } from "./helpers";

const REQUEST_ID = "0b6f3c1e-7d2a-4c5b-9e8f-1a2b3c4d5e6f";
const NOTE = "milanesa con puré, nota privada";
const DISH = "Milanesa con puré de la abuela";
const PHOTO = fixtures.jpeg(64);
const HEIC = readFileSync(path.join(__dirname, "fixtures/foto.heic"));
const INFO = {
  model: "gpt-fake-vision",
  promptVersion: "9.9.9-test",
  usage: { input: 1200, output: 300, total: 1500 },
};

const range = (min: number, max: number) => ({ min, max });
const foodResponse = (overrides: Record<string, unknown> = {}) => ({
  isFood: true,
  analysis: {
    dish: DISH,
    items: [{ name: "Milanesa", grams: range(150, 190), kcal: range(380, 470) }],
    kcal: range(620, 780),
    macros: { protein: range(38, 46), carbs: range(50, 65), fat: range(28, 38) },
    confidence: 0.72,
    ...overrides,
  },
});

/** IA falsa: valida con el mismo zod que el service real y nunca sale a la red. */
function fakeVision(respond: () => unknown) {
  const calls: VisionImage[] = [];
  const vision: VisionService = {
    async analyze(image) {
      calls.push(image);
      return parseVisionResponse(JSON.stringify(await respond()), INFO);
    },
  };
  return { vision, calls };
}

function fakeMedia(photo: Uint8Array): MediaService {
  const fail = () => Promise.reject(new Error("no se usa"));
  return {
    download: async () => photo,
    upload: fail,
    remove: fail,
    removeUserMedia: fail,
    signedUrl: fail,
  };
}

async function createMeal() {
  const userId = new mongoose.Types.ObjectId();
  const _id = new mongoose.Types.ObjectId();
  return MealModel.create({
    _id,
    userId,
    capturedAt: new Date(),
    localDate: "2026-10-25",
    status: "processing",
    media: { photoKey: `users/${userId}/meals/${_id}/photo.jpg` },
    note: NOTE,
  });
}

function setup(respond: () => unknown, photo: Uint8Array = PHOTO) {
  const ai = fakeVision(respond);
  const processor = createMealAnalysisProcessor({
    media: fakeMedia(photo),
    analyze: createAnalyzeMeal({ vision: ai.vision }),
  });
  return { ai, processor, ...captureLogger("worker") };
}

describe("back-service: análisis con IA", () => {
  let mongo: MongoMemoryServer;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });
  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });
  beforeEach(async () => {
    await MealModel.deleteMany({});
  });

  it("si es comida, guarda el análisis con promptVersion y model y queda ready", async () => {
    const meal = await createMeal();
    const { processor, ai, logger, lines } = setup(() => foodResponse());

    assert.equal(await processor({ mealId: meal.id, requestId: REQUEST_ID }, logger), "analyzed");
    assert.equal(ai.calls.length, 1);
    assert.equal(ai.calls[0].contentType, "image/jpeg");

    const saved = await MealModel.findById(meal.id).lean();
    assert.equal(saved?.status, "ready");
    assert.equal(saved?.error, undefined);
    assert.deepEqual(saved?.analysis, {
      ...foodResponse().analysis,
      promptVersion: INFO.promptVersion,
      model: INFO.model,
    });

    const log = lines.find((line) => line.msg === "análisis de la IA");
    assert.ok(log, JSON.stringify(lines));
    assert.equal(log.model, INFO.model);
    assert.equal(log.promptVersion, INFO.promptVersion);
    assert.equal(typeof log.durationMs, "number");
    assert.deepEqual(log.usage, INFO.usage);
    assert.equal(log.result, "ready");
    assert.equal(log.saved, true);
    assert.ok(!JSON.stringify(lines).includes(NOTE));
  });

  for (const [name, response, issuePath] of [
    ["min > max", foodResponse({ kcal: range(800, 600) }), "analysis.kcal"],
    ["confidence 1.5", foodResponse({ confidence: 1.5 }), "analysis.confidence"],
    ["un rango negativo", foodResponse({ kcal: range(-10, 600) }), "analysis.kcal.min"],
    ["isFood true sin análisis", { isFood: true, analysis: null }, "analysis"],
  ] as const) {
    it(`con ${name}, tira error para que BullMQ reintente y queda en processing`, async () => {
      const meal = await createMeal();
      const { processor, logger, lines } = setup(() => response);
      const handle = createMealAnalysisHandler(processor, logger);
      const data = { mealId: meal.id, requestId: REQUEST_ID };

      await assert.rejects(
        handle({ data, attemptsMade: 0, opts: { attempts: 4 } }),
        InvalidVisionResponseError,
      );
      const saved = await MealModel.findById(meal.id).lean();
      assert.equal(saved?.status, "processing");
      assert.equal(saved?.analysis, undefined);

      const warn = lines.find((line) => line.msg === "la IA devolvió un análisis inválido");
      assert.ok(warn, JSON.stringify(lines));
      assert.equal(warn.level, "warn");
      assert.equal(warn.model, INFO.model);
      assert.equal(warn.promptVersion, INFO.promptVersion);
      assert.deepEqual(warn.usage, INFO.usage);
      const issues = warn.issues as { path: string }[];
      assert.ok(
        issues.some((issue) => issue.path === issuePath),
        JSON.stringify(issues),
      );
      assert.equal(lines.find((line) => line.msg === "job de análisis falló")?.willRetry, true);
      // La respuesta cruda no va al log.
      assert.ok(!JSON.stringify(lines).includes(DISH));
    });
  }

  it("si no es comida, queda failed con NOT_FOOD y el job termina sin error", async () => {
    const meal = await createMeal();
    const { processor, logger, lines } = setup(() => ({ isFood: false, analysis: null }));

    assert.equal(await processor({ mealId: meal.id, requestId: REQUEST_ID }, logger), "analyzed");
    const saved = await MealModel.findById(meal.id).lean();
    assert.equal(saved?.status, "failed");
    assert.deepEqual(saved?.error, { code: NOT_FOOD });
    assert.equal(saved?.analysis, undefined);
    const log = lines.find((line) => line.msg === "análisis de la IA");
    assert.equal(log?.result, NOT_FOOD);
    assert.equal(log?.saved, true);
  });

  for (const [name, response] of [
    ["un análisis", foodResponse()],
    ["NOT_FOOD", { isFood: false, analysis: null }],
  ] as const) {
    it(`si la meal cambió de estado durante el análisis, ${name} no la pisa`, async () => {
      const meal = await createMeal();
      const { processor, logger, lines } = setup(async () => {
        await MealModel.updateOne(
          { _id: meal._id },
          { $set: { status: "failed", error: { code: "OTRO" } } },
        );
        return response;
      });

      assert.equal(await processor({ mealId: meal.id, requestId: REQUEST_ID }, logger), "analyzed");
      const saved = await MealModel.findById(meal.id).lean();
      assert.equal(saved?.status, "failed");
      assert.deepEqual(saved?.error, { code: "OTRO" });
      assert.equal(saved?.analysis, undefined);
      assert.equal(lines.find((line) => line.msg === "análisis de la IA")?.saved, false);
    });
  }

  it("una foto HEIC le llega a la IA como JPEG", async () => {
    const meal = await createMeal();
    const { processor, ai, logger } = setup(() => foodResponse(), HEIC);
    await processor({ mealId: meal.id, requestId: REQUEST_ID }, logger);
    assert.equal(ai.calls[0].contentType, "image/jpeg");
    assert.deepEqual([...ai.calls[0].data.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    assert.equal((await MealModel.findById(meal.id).lean())?.status, "ready");
  });
});

describe("back-service: imagen para la IA", () => {
  it("JPEG y PNG pasan tal cual", async () => {
    assert.deepEqual(await toVisionImage(PHOTO), { data: PHOTO, contentType: "image/jpeg" });
    const png = fixtures.png();
    assert.deepEqual(await toVisionImage(png), { data: png, contentType: "image/png" });
  });

  it("rechaza lo que no es una foto", async () => {
    await assert.rejects(toVisionImage(fixtures.text()), /JPEG, PNG ni HEIC/);
  });
});

describe("back-service: prompt de análisis", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "prompt-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const write = (name: string, content: string) => {
    const file = path.join(dir, name);
    writeFileSync(file, content);
    return file;
  };

  it("el prompt del repo tiene autor, versión, fecha y cuerpo", () => {
    const prompt = loadAnalysisPrompt(ANALYSIS_PROMPT_PATH);
    assert.ok(prompt.version);
    assert.ok(prompt.author);
    assert.match(prompt.date ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.match(prompt.system, /isFood/);
  });

  it("lee la versión del frontmatter y el cuerpo como prompt de sistema", () => {
    const file = write(
      "ok.md",
      '---\nautor: Ana\nversion: "2.1.0"\nfecha: 2026-10-25\n---\nSos un analizador.\n',
    );
    assert.deepEqual(loadAnalysisPrompt(file), {
      version: "2.1.0",
      author: "Ana",
      date: "2026-10-25",
      system: "Sos un analizador.",
    });
  });

  it("sin versión no arranca", () => {
    const file = write("sin-version.md", "---\nautor: Ana\nfecha: 2026-10-25\n---\nSos.\n");
    assert.throws(() => loadAnalysisPrompt(file), /no tiene versión/);
  });

  it("sin frontmatter no arranca", () => {
    assert.throws(() => loadAnalysisPrompt(write("plano.md", "Sos.\n")), /frontmatter/);
  });

  it("sin archivo no arranca", () => {
    assert.throws(() => loadAnalysisPrompt(path.join(dir, "no-existe.md")), /No se pudo leer/);
  });
});

describe("back-service: config de OpenAI en el worker", () => {
  it("no arranca sin OPENAI_API_KEY", () => {
    const env = { MONGO_URI: "mongodb://mongo/caloria", REDIS_URL: "redis://redis", ...storageEnv };
    assert.throws(() => loadWorkerConfig(env), /OPENAI_API_KEY/);
  });
});

describe("back-service: service de OpenAI (sin red)", () => {
  const prompt = { version: "1.2.3", system: "PROMPT DE SISTEMA" };

  const openAiResponse = (content: unknown[]) =>
    new Response(
      JSON.stringify({
        id: "resp_1",
        object: "response",
        created_at: 0,
        status: "completed",
        model: "gpt-6-luna-2026-09-01",
        output: [{ type: "message", id: "msg_1", status: "completed", role: "assistant", content }],
        usage: {
          input_tokens: 900,
          output_tokens: 150,
          total_tokens: 1050,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  it("pide structured outputs con la foto y valida la respuesta", async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const vision = createOpenAiVision({
      apiKey: "sk-test",
      model: "gpt-6-luna",
      prompt,
      fetch: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return openAiResponse([
          { type: "output_text", text: JSON.stringify(foodResponse()), annotations: [] },
        ]);
      },
    });

    const result = await vision.analyze({ data: PHOTO, contentType: "image/jpeg" });
    assert.deepEqual(result, {
      model: "gpt-6-luna-2026-09-01",
      promptVersion: "1.2.3",
      usage: { input: 900, output: 150, total: 1050 },
      isFood: true,
      analysis: foodResponse().analysis,
    });

    assert.equal(requests.length, 1);
    const [{ url, body }] = requests;
    assert.match(url, /\/responses$/);
    assert.equal(body.model, "gpt-6-luna");
    assert.equal(body.instructions, "PROMPT DE SISTEMA");
    assert.equal(body.store, false);
    const format = (body.text as { format: Record<string, unknown> }).format;
    assert.equal(format.type, "json_schema");
    assert.equal(format.strict, true);
    const [message] = body.input as { role: string; content: { image_url: string }[] }[];
    assert.equal(message.role, "user");
    assert.equal(
      message.content[0].image_url,
      `data:image/jpeg;base64,${Buffer.from(PHOTO).toString("base64")}`,
    );
  });

  it("una negativa de la IA es una respuesta inválida", async () => {
    const vision = createOpenAiVision({
      apiKey: "sk-test",
      model: "gpt-6-luna",
      prompt,
      fetch: async () => openAiResponse([{ type: "refusal", refusal: "No puedo." }]),
    });
    await assert.rejects(
      vision.analyze({ data: PHOTO, contentType: "image/jpeg" }),
      (err: unknown) =>
        err instanceof InvalidVisionResponseError && err.issues[0].code === "refusal",
    );
  });

  it("corta por timeout y no reintenta por su cuenta", async () => {
    let calls = 0;
    const vision = createOpenAiVision({
      apiKey: "sk-test",
      model: "gpt-6-luna",
      prompt,
      timeoutMs: 50,
      fetch: (_url, init) => {
        calls++;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      },
    });
    await assert.rejects(vision.analyze({ data: PHOTO, contentType: "image/jpeg" }), /timed out/i);
    assert.equal(calls, 1);
  });
});

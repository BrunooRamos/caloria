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
  cleanTranscript,
  createOpenAiTranscription,
  TRANSCRIPTION_LANGUAGE,
} from "../src/services/transcription";
import type { TranscriptionService } from "../src/services/transcription";
import {
  createOpenAiVision,
  InvalidVisionResponseError,
  NOTE_LABEL,
  parseVisionResponse,
  TRANSCRIPT_LABEL,
} from "../src/services/vision";
import type { VisionInput, VisionService } from "../src/services/vision";
import { toVisionImage } from "../src/services/vision-image";
import { captureLogger, fixtures, storageEnv } from "./helpers";

const REQUEST_ID = "0b6f3c1e-7d2a-4c5b-9e8f-1a2b3c4d5e6f";
const NOTE = "milanesa con puré, nota privada";
const DISH = "Milanesa con puré de la abuela";
const TRANSCRIPT = "le puse dos cucharadas de aceite de oliva, transcripción privada";
const PHOTO = fixtures.jpeg(64);
const AUDIO = fixtures.m4a(12);
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
  const calls: VisionInput[] = [];
  const vision: VisionService = {
    async analyze(input) {
      calls.push(input);
      return parseVisionResponse(JSON.stringify(await respond()), INFO);
    },
  };
  return { vision, calls };
}

/** Transcriptor falso: devuelve `respond()` (o lanza) y nunca sale a la red. */
function fakeTranscriber(respond: () => string | Promise<string> = () => TRANSCRIPT) {
  const calls: Uint8Array[] = [];
  const transcriber: TranscriptionService = {
    model: "gpt-fake-transcribe",
    async transcribe(audio) {
      calls.push(audio);
      return respond();
    },
  };
  return { transcriber, calls };
}

function fakeMedia(photo: Uint8Array): MediaService {
  const fail = () => Promise.reject(new Error("no se usa"));
  return {
    download: async (key) => (key.endsWith("/audio.m4a") ? AUDIO : photo),
    upload: fail,
    remove: fail,
    removeUserMedia: fail,
    signedUrl: fail,
  };
}

async function createMeal({
  audio = false,
  note = NOTE,
  transcript = undefined as string | undefined,
} = {}) {
  const userId = new mongoose.Types.ObjectId();
  const _id = new mongoose.Types.ObjectId();
  const prefix = `users/${userId}/meals/${_id}`;
  return MealModel.create({
    _id,
    userId,
    capturedAt: new Date(),
    localDate: "2026-10-25",
    status: "processing",
    media: { photoKey: `${prefix}/photo.jpg`, ...(audio && { audioKey: `${prefix}/audio.m4a` }) },
    ...(note && { note }),
    ...(transcript && { transcript }),
  });
}

function setup(
  respond: () => unknown,
  photo: Uint8Array = PHOTO,
  stt: ReturnType<typeof fakeTranscriber> = fakeTranscriber(),
) {
  const ai = fakeVision(respond);
  const processor = createMealAnalysisProcessor({
    media: fakeMedia(photo),
    analyze: createAnalyzeMeal({
      vision: ai.vision,
      transcriber: stt.transcriber,
      // Los avisos se prueban en notifications.test.ts.
      notifications: { notify: async () => "noDevices" },
    }),
  });
  return { ai, stt, processor, ...captureLogger("worker") };
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
    assert.equal(ai.calls[0].image.contentType, "image/jpeg");

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
    assert.equal(log.withTranscript, false);
    assert.equal(log.withNote, true);
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
    assert.equal(ai.calls[0].image.contentType, "image/jpeg");
    assert.deepEqual([...ai.calls[0].image.data.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    assert.equal((await MealModel.findById(meal.id).lean())?.status, "ready");
  });

  describe("transcripción del audio", () => {
    it("con audio, guarda el transcript y le llega a la IA junto con la nota", async () => {
      const meal = await createMeal({ audio: true });
      const { processor, ai, stt, logger, lines } = setup(() => foodResponse());

      assert.equal(await processor({ mealId: meal.id, requestId: REQUEST_ID }, logger), "analyzed");
      assert.equal(stt.calls.length, 1);
      assert.deepEqual(stt.calls[0], AUDIO);
      assert.equal(ai.calls[0].transcript, TRANSCRIPT);
      assert.equal(ai.calls[0].note, NOTE);

      const saved = await MealModel.findById(meal.id).lean();
      assert.equal(saved?.transcript, TRANSCRIPT);
      assert.equal(saved?.status, "ready");

      const log = lines.find((line) => line.msg === "transcripción del audio");
      assert.ok(log, JSON.stringify(lines));
      assert.equal(log.model, "gpt-fake-transcribe");
      assert.equal(typeof log.durationMs, "number");
      assert.equal(log.reused, false);
      assert.equal(log.chars, TRANSCRIPT.length);
      const analysisLog = lines.find((line) => line.msg === "análisis de la IA");
      assert.equal(analysisLog?.withTranscript, true);
      assert.equal(analysisLog?.withNote, true);
      // Ni el texto transcripto ni la nota van al log.
      assert.ok(!JSON.stringify(lines).includes(TRANSCRIPT));
      assert.ok(!JSON.stringify(lines).includes(NOTE));
    });

    it("sin audio ni nota, no se llama al transcriptor y la IA recibe solo la foto", async () => {
      const meal = await createMeal({ note: "" });
      const { processor, ai, stt, logger, lines } = setup(() => foodResponse());

      await processor({ mealId: meal.id, requestId: REQUEST_ID }, logger);
      assert.equal(stt.calls.length, 0);
      assert.deepEqual(Object.keys(ai.calls[0]), ["image"]);
      assert.equal(ai.calls[0].transcript, undefined);
      assert.equal(ai.calls[0].note, undefined);
      assert.ok(!lines.some((line) => line.msg === "transcripción del audio"));
      const log = lines.find((line) => line.msg === "análisis de la IA");
      assert.equal(log?.withTranscript, false);
      assert.equal(log?.withNote, false);
      const saved = await MealModel.findById(meal.id).lean();
      assert.equal(saved?.status, "ready");
      assert.equal(saved?.transcript, undefined);
    });

    it("con nota y sin audio, la nota le llega a la IA", async () => {
      const meal = await createMeal();
      const { processor, ai, stt, logger } = setup(() => foodResponse());

      await processor({ mealId: meal.id, requestId: REQUEST_ID }, logger);
      assert.equal(stt.calls.length, 0);
      assert.equal(ai.calls[0].note, NOTE);
      assert.equal(ai.calls[0].transcript, undefined);
    });

    it("si la transcripción viene vacía o es solo ruido, sigue como si no hubiera audio", async () => {
      const meal = await createMeal({ audio: true, note: undefined });
      const stt = fakeTranscriber(() => "");
      const { processor, ai, logger, lines } = setup(() => foodResponse(), PHOTO, stt);

      await processor({ mealId: meal.id, requestId: REQUEST_ID }, logger);
      assert.equal(stt.calls.length, 1);
      assert.equal(ai.calls[0].transcript, undefined);
      assert.equal(lines.find((line) => line.msg === "transcripción del audio")?.chars, 0);
      const saved = await MealModel.findById(meal.id).lean();
      assert.equal(saved?.transcript, undefined);
      assert.equal(saved?.status, "ready");
    });

    it("en un reintento con el transcript ya guardado, no se vuelve a transcribir", async () => {
      const meal = await createMeal({ audio: true, transcript: TRANSCRIPT });
      const { processor, ai, stt, logger, lines } = setup(() => foodResponse());

      await processor({ mealId: meal.id, requestId: REQUEST_ID }, logger);
      assert.equal(stt.calls.length, 0);
      assert.equal(ai.calls[0].transcript, TRANSCRIPT);
      const log = lines.find((line) => line.msg === "transcripción del audio");
      assert.equal(log?.reused, true);
      assert.equal(log?.chars, TRANSCRIPT.length);
    });

    it("si la visión falla, el transcript queda guardado para el reintento", async () => {
      const meal = await createMeal({ audio: true });
      const { processor, stt, logger } = setup(() => foodResponse({ confidence: 2 }));
      const handle = createMealAnalysisHandler(processor, logger);
      const job = {
        data: { mealId: meal.id, requestId: REQUEST_ID },
        attemptsMade: 0,
        opts: { attempts: 4 },
      };

      await assert.rejects(handle(job), InvalidVisionResponseError);
      await assert.rejects(handle({ ...job, attemptsMade: 1 }), InvalidVisionResponseError);
      assert.equal(stt.calls.length, 1);
      const saved = await MealModel.findById(meal.id).lean();
      assert.equal(saved?.transcript, TRANSCRIPT);
      assert.equal(saved?.status, "processing");
    });

    it("si falla el transcriptor, el error se propaga y la meal queda en processing", async () => {
      const meal = await createMeal({ audio: true });
      const stt = fakeTranscriber(() => {
        throw new Error("transcripción caída");
      });
      const { processor, ai, logger, lines } = setup(() => foodResponse(), PHOTO, stt);
      const handle = createMealAnalysisHandler(processor, logger);

      await assert.rejects(
        handle({
          data: { mealId: meal.id, requestId: REQUEST_ID },
          attemptsMade: 0,
          opts: { attempts: 4 },
        }),
        /transcripción caída/,
      );
      assert.equal(ai.calls.length, 0);
      const saved = await MealModel.findById(meal.id).lean();
      assert.equal(saved?.status, "processing");
      assert.equal(saved?.transcript, undefined);
      assert.equal(lines.find((line) => line.msg === "job de análisis falló")?.willRetry, true);
    });

    it("si la meal cambió de estado mientras transcribía, no se pisa", async () => {
      const meal = await createMeal({ audio: true });
      const stt = fakeTranscriber(async () => {
        await MealModel.updateOne(
          { _id: meal._id },
          { $set: { status: "failed", error: { code: "OTRO" } } },
        );
        return TRANSCRIPT;
      });
      const { processor, ai, logger, lines } = setup(() => foodResponse(), PHOTO, stt);

      assert.equal(await processor({ mealId: meal.id, requestId: REQUEST_ID }, logger), "analyzed");
      assert.equal(ai.calls.length, 0);
      const saved = await MealModel.findById(meal.id).lean();
      assert.equal(saved?.status, "failed");
      assert.deepEqual(saved?.error, { code: "OTRO" });
      assert.equal(saved?.transcript, undefined);
      assert.ok(
        lines.some(
          (line) => line.msg === "la comida cambió de estado durante la transcripción, no se pisa",
        ),
      );
    });
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

    const result = await vision.analyze({ image: { data: PHOTO, contentType: "image/jpeg" } });
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

  describe("partes de texto del mensaje", () => {
    const image = { data: PHOTO, contentType: "image/jpeg" as const };

    async function sentContent(input: Omit<VisionInput, "image">) {
      let content: { type: string; text?: string }[] = [];
      const vision = createOpenAiVision({
        apiKey: "sk-test",
        model: "gpt-6-luna",
        prompt,
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as {
            input: { content: typeof content }[];
          };
          content = body.input[0].content;
          return openAiResponse([
            { type: "output_text", text: JSON.stringify(foodResponse()), annotations: [] },
          ]);
        },
      });
      await vision.analyze({ image, ...input });
      return content;
    }

    it("sin transcript ni nota, solo va la foto", async () => {
      assert.deepEqual(
        (await sentContent({})).map((part) => part.type),
        ["input_image"],
      );
      // Vacíos o en blanco cuentan como ausentes.
      assert.deepEqual(
        (await sentContent({ transcript: " ", note: "" })).map((part) => part.type),
        ["input_image"],
      );
    });

    it("con transcript y nota, van como partes input_text rotuladas", async () => {
      const content = await sentContent({ transcript: TRANSCRIPT, note: NOTE });
      assert.deepEqual(content.slice(1), [
        { type: "input_text", text: `${TRANSCRIPT_LABEL}\n${TRANSCRIPT}` },
        { type: "input_text", text: `${NOTE_LABEL}\n${NOTE}` },
      ]);
      assert.equal(TRANSCRIPT_LABEL, "Audio del usuario:");
      assert.equal(NOTE_LABEL, "Nota del usuario:");
    });

    it("con solo la nota, va solo la nota", async () => {
      const content = await sentContent({ note: NOTE });
      assert.deepEqual(content.slice(1), [{ type: "input_text", text: `${NOTE_LABEL}\n${NOTE}` }]);
    });
  });

  it("una negativa de la IA es una respuesta inválida", async () => {
    const vision = createOpenAiVision({
      apiKey: "sk-test",
      model: "gpt-6-luna",
      prompt,
      fetch: async () => openAiResponse([{ type: "refusal", refusal: "No puedo." }]),
    });
    await assert.rejects(
      vision.analyze({ image: { data: PHOTO, contentType: "image/jpeg" } }),
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
    await assert.rejects(
      vision.analyze({ image: { data: PHOTO, contentType: "image/jpeg" } }),
      /timed out/i,
    );
    assert.equal(calls, 1);
  });
});

describe("back-service: service de transcripción de OpenAI (sin red)", () => {
  // En multipart el SDK prueba el fetch con un `data:` antes de usarlo; con `Response` no lo hace.
  const fakeFetch = (fetch: typeof globalThis.fetch) => Object.assign(fetch, { Response });

  const transcriptionResponse = (text: string) =>
    new Response(JSON.stringify({ text, usage: { type: "duration", seconds: 12 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  function setupTranscription(
    model: string,
    respond: () => Response = () => transcriptionResponse(` ${TRANSCRIPT} `),
  ) {
    const requests: { url: string; form: FormData }[] = [];
    const transcriber = createOpenAiTranscription({
      apiKey: "sk-test",
      model,
      fetch: fakeFetch(async (url, init) => {
        requests.push({ url: String(url), form: await new Request(String(url), init).formData() });
        return respond();
      }),
    });
    return { transcriber, requests };
  }

  it("manda el M4A con el modelo y el idioma español, y devuelve el texto", async () => {
    const { transcriber, requests } = setupTranscription("gpt-transcribe");

    assert.equal(transcriber.model, "gpt-transcribe");
    assert.equal(await transcriber.transcribe(AUDIO), TRANSCRIPT);
    assert.equal(requests.length, 1);
    const [{ url, form }] = requests;
    assert.match(url, /\/audio\/transcriptions$/);
    assert.equal(form.get("model"), "gpt-transcribe");
    // gpt-transcribe recibe el idioma en `languages`, no en `language`.
    assert.deepEqual(form.getAll("languages[]"), [TRANSCRIPTION_LANGUAGE]);
    assert.equal(form.get("language"), null);
    assert.equal(form.get("response_format"), "json");
    const file = form.get("file");
    assert.ok(file instanceof File);
    assert.equal(file.name, "audio.m4a");
    assert.equal(file.type, "audio/mp4");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), AUDIO);
  });

  it("con un modelo anterior, el idioma va en `language`", async () => {
    const { transcriber, requests } = setupTranscription("gpt-4o-mini-transcribe");
    await transcriber.transcribe(AUDIO);
    assert.equal(requests[0].form.get("language"), TRANSCRIPTION_LANGUAGE);
    assert.deepEqual(requests[0].form.getAll("languages[]"), []);
  });

  it("vacía o solo ruido, devuelve texto vacío", async () => {
    for (const text of ["", "   ", "...", "♪ ♪", "[música]", "(ruido de fondo) …"]) {
      const { transcriber } = setupTranscription("gpt-transcribe", () =>
        transcriptionResponse(text),
      );
      assert.equal(await transcriber.transcribe(AUDIO), "", JSON.stringify(text));
    }
    assert.equal(cleanTranscript(" 2 huevos "), "2 huevos");
  });

  it("corta por timeout y no reintenta por su cuenta", async () => {
    let calls = 0;
    const transcriber = createOpenAiTranscription({
      apiKey: "sk-test",
      model: "gpt-transcribe",
      timeoutMs: 50,
      fetch: fakeFetch((_url, init) => {
        calls++;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      }),
    });
    await assert.rejects(transcriber.transcribe(AUDIO), /timed out/i);
    assert.equal(calls, 1);
  });

  it("un error de la API se propaga sin reintento", async () => {
    let calls = 0;
    const { transcriber } = setupTranscription("gpt-transcribe", () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: "boom" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    });
    await assert.rejects(transcriber.transcribe(AUDIO));
    assert.equal(calls, 1);
  });
});

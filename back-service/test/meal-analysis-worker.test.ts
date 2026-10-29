import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import {
  DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
  DEFAULT_OPENAI_VISION_MODEL,
  DEFAULT_WORKER_CONCURRENCY,
  loadWorkerConfig,
} from "../src/config/worker";
import {
  createMealAnalysisQueue,
  MEAL_ANALYSIS_JOB_OPTIONS,
  MEAL_ANALYSIS_QUEUE,
} from "../src/jobs/meal-analysis";
import type { MealAnalysisJob, MealAnalysisQueue } from "../src/jobs/meal-analysis";
import { createMealAnalysisProcessor } from "../src/jobs/meal-analysis-processor";
import type { MealAnalysisInput } from "../src/jobs/meal-analysis-processor";
import {
  ANALYSIS_FAILED,
  createMealAnalysisHandler,
  createMealAnalysisWorker,
} from "../src/jobs/meal-analysis-worker";
import type { MealAnalysisWorker } from "../src/jobs/meal-analysis-worker";
import { MealModel } from "../src/models/Meal";
import type { MealStatus } from "../src/models/Meal";
import type { MediaService } from "../src/services/media";
import { captureLogger, storageEnv } from "./helpers";

const REQUEST_ID = "0b6f3c1e-7d2a-4c5b-9e8f-1a2b3c4d5e6f";
const NOTE = "milanesa con puré, nota privada";
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const AUDIO = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]);

const workerEnv = {
  MONGO_URI: "mongodb://mongo:27017/caloria",
  REDIS_URL: "redis://redis:6379",
  OPENAI_API_KEY: "sk-test",
  ...storageEnv,
};

/** Bucket en memoria: solo `download` tiene que funcionar en el worker. */
function fakeMedia() {
  const objects = new Map<string, Uint8Array>();
  const downloads: string[] = [];
  const removed: string[] = [];
  let fails = false;
  const media: MediaService = {
    async download(key) {
      downloads.push(key);
      if (fails) throw new Error("bucket no disponible");
      const body = objects.get(key);
      if (!body) throw new Error(`no existe ${key}`);
      return body;
    },
    upload: () => Promise.reject(new Error("el worker no sube")),
    remove: (key) => {
      removed.push(key);
      return Promise.reject(new Error("el worker no borra"));
    },
    removeUserMedia: (key) => {
      removed.push(key);
      return Promise.reject(new Error("el worker no borra"));
    },
    signedUrl: () => Promise.reject(new Error("el worker no firma")),
  };
  return {
    media,
    objects,
    downloads,
    removed,
    failNext(value = true) {
      fails = value;
    },
  };
}

function recordingAnalyze() {
  const calls: MealAnalysisInput[] = [];
  let notify: (() => void) | undefined;
  return {
    calls,
    analyze: async (input: MealAnalysisInput) => {
      calls.push(input);
      notify?.();
    },
    /** Resuelve con la próxima llamada a `analyze`. */
    next: () => new Promise<void>((resolve) => (notify = resolve)),
  };
}

async function createMeal({ audio = false, status = "processing" as MealStatus } = {}) {
  const userId = new mongoose.Types.ObjectId();
  const _id = new mongoose.Types.ObjectId();
  const prefix = `users/${userId}/meals/${_id}`;
  return MealModel.create({
    _id,
    userId,
    capturedAt: new Date(),
    localDate: "2026-10-06",
    status,
    media: { photoKey: `${prefix}/photo.jpg`, ...(audio && { audioKey: `${prefix}/audio.m4a` }) },
    note: NOTE,
  });
}

describe("back-service: config del worker", () => {
  it("no necesita la clave privada de JWT", () => {
    const config = loadWorkerConfig(workerEnv);
    assert.equal(config.mongoUri, workerEnv.MONGO_URI);
    assert.equal(config.redisUrl, workerEnv.REDIS_URL);
    assert.equal(config.storage.bucket, storageEnv.S3_BUCKET);
    assert.ok(!("jwtPrivateKey" in config));
  });

  it(`la concurrencia vale ${DEFAULT_WORKER_CONCURRENCY} por defecto`, () => {
    assert.equal(DEFAULT_WORKER_CONCURRENCY, 2);
    assert.equal(loadWorkerConfig(workerEnv).concurrency, 2);
    assert.equal(loadWorkerConfig({ ...workerEnv, WORKER_CONCURRENCY: " " }).concurrency, 2);
  });

  it("toma WORKER_CONCURRENCY", () => {
    assert.equal(loadWorkerConfig({ ...workerEnv, WORKER_CONCURRENCY: "5" }).concurrency, 5);
  });

  for (const value of ["0", "-1", "1.5", "abc", "3x", "1e2", "0x10", "99999999999999999999"]) {
    it(`no arranca con WORKER_CONCURRENCY=${value}`, () => {
      assert.throws(
        () => loadWorkerConfig({ ...workerEnv, WORKER_CONCURRENCY: value }),
        /WORKER_CONCURRENCY/,
      );
    });
  }

  it("toma la clave de OpenAI y los modelos de visión y transcripción, con default", () => {
    assert.deepEqual(loadWorkerConfig(workerEnv).openai, {
      apiKey: "sk-test",
      visionModel: DEFAULT_OPENAI_VISION_MODEL,
      transcriptionModel: DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
    });
    assert.equal(DEFAULT_OPENAI_TRANSCRIPTION_MODEL, "gpt-transcribe");
    const config = loadWorkerConfig({
      ...workerEnv,
      OPENAI_VISION_MODEL: "gpt-6.1-sol",
      OPENAI_TRANSCRIPTION_MODEL: " gpt-4o-mini-transcribe ",
    });
    assert.equal(config.openai.visionModel, "gpt-6.1-sol");
    assert.equal(config.openai.transcriptionModel, "gpt-4o-mini-transcribe");
    // En blanco cuenta como sin definir.
    const blank = loadWorkerConfig({ ...workerEnv, OPENAI_TRANSCRIPTION_MODEL: " " });
    assert.equal(blank.openai.transcriptionModel, DEFAULT_OPENAI_TRANSCRIPTION_MODEL);
  });

  for (const name of ["MONGO_URI", "REDIS_URL", "S3_BUCKET", "OPENAI_API_KEY"]) {
    it(`no arranca sin ${name}`, () => {
      assert.throws(() => loadWorkerConfig({ ...workerEnv, [name]: " " }), new RegExp(name));
    });
  }
});

describe("back-service: worker de análisis", () => {
  let mongo: MongoMemoryServer;
  let bucket: ReturnType<typeof fakeMedia>;
  let ai: ReturnType<typeof recordingAnalyze>;
  let processor: ReturnType<typeof createMealAnalysisProcessor>;

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
    bucket = fakeMedia();
    ai = recordingAnalyze();
    processor = createMealAnalysisProcessor({ media: bucket.media, analyze: ai.analyze });
  });

  describe("processor", () => {
    it("si la comida no existe, termina sin error y sin analizar", async () => {
      const { logger, lines } = captureLogger("worker");
      for (const mealId of [new mongoose.Types.ObjectId().toString(), "no-es-un-object-id"]) {
        const outcome = await processor({ mealId, requestId: REQUEST_ID }, logger);
        assert.equal(outcome, "missing");
      }
      assert.equal(ai.calls.length, 0);
      assert.equal(bucket.downloads.length, 0);
      assert.equal(lines.filter((line) => line.level === "warn").length, 2);
    });

    it("si la comida ya no está en processing, la saltea sin tocar el bucket", async () => {
      const meal = await createMeal({ status: "ready" });
      const { logger } = captureLogger("worker");
      const outcome = await processor({ mealId: meal.id, requestId: REQUEST_ID }, logger);
      assert.equal(outcome, "skipped");
      assert.equal(ai.calls.length, 0);
      assert.equal(bucket.downloads.length, 0);
      assert.equal((await MealModel.findById(meal.id).lean())?.status, "ready");
    });

    it("baja foto y audio y se los pasa a analyze con la comida", async () => {
      const meal = await createMeal({ audio: true });
      bucket.objects.set(meal.media.photoKey, PHOTO);
      bucket.objects.set(meal.media.audioKey!, AUDIO);

      const { logger } = captureLogger("worker");
      const outcome = await processor({ mealId: meal.id, requestId: REQUEST_ID }, logger);
      assert.equal(outcome, "analyzed");
      assert.equal(ai.calls.length, 1);
      const [{ meal: analyzed, photo, audio }] = ai.calls;
      assert.equal(analyzed._id.toString(), meal.id);
      assert.equal(analyzed.note, NOTE);
      assert.deepEqual(photo, PHOTO);
      assert.deepEqual(audio, AUDIO);
      // Este analyze no hace nada: la comida sigue en processing.
      assert.equal((await MealModel.findById(meal.id).lean())?.status, "processing");
    });

    it("sin audio, analyze recibe solo la foto", async () => {
      const meal = await createMeal();
      bucket.objects.set(meal.media.photoKey, PHOTO);
      const { logger } = captureLogger("worker");
      await processor({ mealId: meal.id, requestId: REQUEST_ID }, logger);
      assert.deepEqual(bucket.downloads, [meal.media.photoKey]);
      assert.equal(ai.calls[0].audio, undefined);
    });

    it("un error del bucket se propaga para que BullMQ reintente", async () => {
      const meal = await createMeal({ audio: true });
      bucket.failNext();
      const { logger } = captureLogger("worker");
      await assert.rejects(processor({ mealId: meal.id, requestId: REQUEST_ID }, logger), {
        message: "bucket no disponible",
      });
      assert.equal(ai.calls.length, 0);
      assert.equal((await MealModel.findById(meal.id).lean())?.status, "processing");
    });
  });

  describe("logs de cada job", () => {
    const opts = { attempts: MEAL_ANALYSIS_JOB_OPTIONS.attempts };

    it("loguea ids, intento y duración cuando termina", async () => {
      const meal = await createMeal({ audio: true });
      bucket.objects.set(meal.media.photoKey, PHOTO);
      bucket.objects.set(meal.media.audioKey!, AUDIO);
      const { logger, lines } = captureLogger("worker");
      const handle = createMealAnalysisHandler(processor, logger);

      await handle({ data: { mealId: meal.id, requestId: REQUEST_ID }, attemptsMade: 0, opts });
      const log = lines.find((line) => line.msg === "job de análisis terminado");
      assert.ok(log, JSON.stringify(lines));
      assert.equal(log.service, "worker");
      assert.equal(log.level, "info");
      assert.equal(log.mealId, meal.id);
      assert.equal(log.requestId, REQUEST_ID);
      assert.equal(log.attempt, 1);
      assert.equal(log.maxAttempts, 4);
      assert.equal(log.outcome, "analyzed");
      assert.equal(typeof log.durationMs, "number");
      // Ni la nota ni la media van al log.
      const raw = JSON.stringify(lines);
      assert.ok(!raw.includes(NOTE));
      assert.ok(!raw.includes(meal.media.photoKey));
    });

    it("si falla, loguea el error y si va a reintentar, y lo vuelve a tirar", async () => {
      const meal = await createMeal();
      bucket.failNext();
      const { logger, lines } = captureLogger("worker");
      const handle = createMealAnalysisHandler(processor, logger);
      const data = { mealId: meal.id, requestId: REQUEST_ID };

      await assert.rejects(handle({ data, attemptsMade: 0, opts }), /bucket no disponible/);
      await assert.rejects(handle({ data, attemptsMade: 3, opts }), /bucket no disponible/);
      const failures = lines.filter((line) => line.msg === "job de análisis falló");
      assert.equal(failures.length, 2);
      const [first, last] = failures as Record<string, unknown>[];
      assert.equal(first.level, "error");
      assert.equal(first.mealId, meal.id);
      assert.equal(first.requestId, REQUEST_ID);
      assert.equal(first.attempt, 1);
      assert.equal(first.willRetry, true);
      assert.equal(typeof first.durationMs, "number");
      assert.equal((first.err as { message: string }).message, "bucket no disponible");
      assert.equal(last.attempt, 4);
      assert.equal(last.willRetry, false);
    });
  });

  describe("reintentos agotados (RNF-02)", () => {
    const opts = { attempts: MEAL_ANALYSIS_JOB_OPTIONS.attempts };

    it("3 reintentos con backoff exponencial", () => {
      assert.equal(MEAL_ANALYSIS_JOB_OPTIONS.attempts, 4);
      assert.deepEqual(MEAL_ANALYSIS_JOB_OPTIONS.backoff, { type: "exponential", delay: 5_000 });
    });

    it("sigue en processing hasta el último intento y ahí queda failed con ANALYSIS_FAILED", async () => {
      const meal = await createMeal({ audio: true });
      bucket.failNext();
      const { logger, lines } = captureLogger("worker");
      const handle = createMealAnalysisHandler(processor, logger);
      const data = { mealId: meal.id, requestId: REQUEST_ID };

      for (let attemptsMade = 0; attemptsMade < 3; attemptsMade++) {
        await assert.rejects(handle({ data, attemptsMade, opts }), /bucket no disponible/);
        const stored = await MealModel.findById(meal.id).lean();
        assert.equal(stored?.status, "processing");
        assert.equal(stored?.attempts, attemptsMade + 1);
        assert.equal(stored?.error, undefined);
      }
      await assert.rejects(handle({ data, attemptsMade: 3, opts }), /bucket no disponible/);

      const stored = await MealModel.findById(meal.id).lean();
      assert.equal(stored?.status, "failed");
      assert.deepEqual(stored?.error, { code: ANALYSIS_FAILED });
      assert.equal(stored?.attempts, 4);
      // La media sigue en el bucket y en la meal.
      assert.deepEqual(stored?.media, meal.toObject().media);
      assert.deepEqual(bucket.removed, []);
      const log = lines.find(
        (line) => line.msg === "se agotaron los reintentos: la comida queda en failed",
      );
      assert.equal(log?.level, "warn");
      assert.equal(log?.mealId, meal.id);
      assert.equal(log?.errorCode, ANALYSIS_FAILED);
    });

    for (const status of ["ready", "failed"] as const) {
      it(`no pisa una meal que ya está en ${status}`, async () => {
        const meal = await createMeal({ status });
        const { logger } = captureLogger("worker");
        const failing = () => Promise.reject(new Error("IA caída"));
        const handle = createMealAnalysisHandler(failing, logger);
        const data = { mealId: meal.id, requestId: REQUEST_ID };

        await assert.rejects(handle({ data, attemptsMade: 3, opts }), /IA caída/);
        const stored = await MealModel.findById(meal.id).lean();
        assert.equal(stored?.status, status);
        assert.equal(stored?.attempts, 0);
        assert.equal(stored?.error, undefined);
      });
    }

    it("si Mongo falla al registrar el intento, el job igual tira el error original", async () => {
      const meal = await createMeal();
      const { logger, lines } = captureLogger("worker");
      const failing = () => Promise.reject(new Error("IA caída"));
      const handle = createMealAnalysisHandler(failing, logger);
      const data = { mealId: meal.id, requestId: REQUEST_ID };

      const original = MealModel.updateOne.bind(MealModel);
      MealModel.updateOne = (() => Promise.reject(new Error("mongo caído"))) as never;
      try {
        await assert.rejects(handle({ data, attemptsMade: 3, opts }), /IA caída/);
      } finally {
        MealModel.updateOne = original;
      }
      const log = lines.find(
        (line) => line.msg === "no se pudo registrar el intento fallido en la comida",
      );
      assert.equal(log?.level, "error");
      assert.equal(log?.final, true);
    });
  });

  // Contra un Redis real (ver back-service/README.md). Sin REDIS_TEST_URL se saltea.
  const redisUrl = process.env.REDIS_TEST_URL;
  describe("con Redis", { skip: !redisUrl && "falta REDIS_TEST_URL" }, () => {
    const prefix = `test-${randomUUID()}`;
    let queue: MealAnalysisQueue;
    let worker: MealAnalysisWorker | undefined;
    let connection: IORedis;
    let inspector: Queue<MealAnalysisJob>;

    before(async () => {
      queue = createMealAnalysisQueue({
        redisUrl: redisUrl!,
        logger: captureLogger("back").logger,
        prefix,
      });
      await queue.ready();
      connection = new IORedis(redisUrl!, { maxRetriesPerRequest: null });
      inspector = new Queue<MealAnalysisJob>(MEAL_ANALYSIS_QUEUE, { connection, prefix });
    });
    after(async () => {
      await inspector.obliterate({ force: true });
      await inspector.close();
      connection.disconnect();
      await queue.close();
    });
    afterEach(async () => {
      await worker?.close();
      worker = undefined;
      await inspector.obliterate({ force: true });
    });

    it("el worker consume el job encolado por el Back", { timeout: 10_000 }, async () => {
      const meal = await createMeal({ audio: true });
      bucket.objects.set(meal.media.photoKey, PHOTO);
      bucket.objects.set(meal.media.audioKey!, AUDIO);
      const { logger, lines } = captureLogger("worker");
      worker = createMealAnalysisWorker({
        redisUrl: redisUrl!,
        concurrency: 2,
        processor,
        logger,
        prefix,
      });
      await worker.ready();

      const analyzed = ai.next();
      await queue.enqueue({ mealId: meal.id, requestId: REQUEST_ID });
      await analyzed;
      assert.equal(ai.calls[0].meal._id.toString(), meal.id);
      assert.deepEqual(ai.calls[0].photo, PHOTO);

      // El log se escribe apenas termina analyze; el job pasa a completed justo después.
      for (let i = 0; i < 50 && (await inspector.getJobState(meal.id)) !== "completed"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(await inspector.getJobState(meal.id), "completed");
      const log = lines.find((line) => line.msg === "job de análisis terminado");
      assert.equal(log?.mealId, meal.id);
      assert.equal(log?.requestId, REQUEST_ID);
      assert.equal(log?.attempt, 1);
    });
  });
});

import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { loadStorageConfig } from "../src/config/storage";
import { createApp } from "../src/app";
import {
  createMealAnalysisQueue,
  MEAL_ANALYSIS_QUEUE,
  MEAL_ANALYSIS_JOB_OPTIONS,
} from "../src/jobs/meal-analysis";
import type { MealAnalysisJob, MealAnalysisQueue } from "../src/jobs/meal-analysis";
import { MealModel } from "../src/models/Meal";
import { UserModel } from "../src/models/User";
import { apiRouter } from "../src/routes";
import { createAuthService } from "../src/services/auth";
import { ENQUEUE_FAILED, createMealService } from "../src/services/meals";
import { createMediaService } from "../src/services/media";
import { computeTargets } from "../src/services/targets";
import { signAccessToken } from "../src/services/tokens";
import { createUserService } from "../src/services/users";
import { captureLogger, fixtures, listen, storageEnv } from "./helpers";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const REQUEST_ID = "0b6f3c1e-7d2a-4c5b-9e8f-1a2b3c4d5e6f";
// 23:30 del 6 de octubre en Montevideo (UTC-3) ya es el 7 de octubre en UTC.
const NOW = new Date("2026-10-07T02:30:00Z");
const profile = {
  sex: "female",
  birthDate: "2002-04-10",
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: "America/Montevideo",
} as const;

type Envelope = { error: { code: string; requestId: string } };
type S3Command = { input: { Key: string; Body?: Uint8Array; ContentType?: string } };

/** Bucket en memoria: se intercepta el cliente S3, así se prueba el service de media real. */
const bucket = new Map<string, { body: Uint8Array; contentType?: string }>();
let bucketFails: ((key: string) => boolean) | undefined;

/** Cola que registra los jobs sin Redis; los tests con Redis real están más abajo. */
function recordingQueue() {
  const jobs: MealAnalysisJob[] = [];
  const queue: MealAnalysisQueue = {
    async enqueue(job) {
      jobs.push(job);
    },
    async ready() {},
    async close() {},
  };
  return { queue, jobs };
}

interface MealFormOptions {
  photo?: Buffer | null;
  photoName?: string;
  photoType?: string;
  audio?: Buffer;
  note?: string;
  extra?: Record<string, string | Blob>;
}

function mealForm({
  photo = fixtures.jpeg(),
  photoName = "plato.jpg",
  photoType = "image/jpeg",
  audio,
  note,
  extra = {},
}: MealFormOptions = {}): FormData {
  const form = new FormData();
  if (photo)
    form.append("photo", new Blob([new Uint8Array(photo)], { type: photoType }), photoName);
  if (audio)
    form.append("audio", new Blob([new Uint8Array(audio)], { type: "audio/mp4" }), "nota.m4a");
  if (note !== undefined) form.append("note", note);
  for (const [name, value] of Object.entries(extra)) form.append(name, value);
  return form;
}

describe("back-service: POST /meals", () => {
  let mongo: MongoMemoryServer;
  let userId: string;
  let token: string;

  async function startApp(queue: MealAnalysisQueue) {
    const { logger, lines } = captureLogger("back");
    const meals = createMealService({
      media: createMediaService(loadStorageConfig(storageEnv)),
      queue,
      now: () => NOW,
    });
    const auth = createAuthService({ privateKey });
    const api = apiRouter({ auth, users: createUserService(), meals, publicKey });
    return { ...(await listen(createApp({ logger, api }))), lines };
  }

  const post = (url: string, form: FormData, auth: string | null = `Bearer ${token}`) =>
    fetch(`${url}/api/v1/meals`, {
      method: "POST",
      headers: { "x-request-id": REQUEST_ID, ...(auth && { authorization: auth }) },
      body: form,
    });

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
    const user = await UserModel.create({
      email: "cami@example.com",
      passwordHash: "no-se-usa",
      profile,
      targets: computeTargets(profile),
    });
    userId = user.id as string;
    token = signAccessToken({ sub: userId, plan: "free" }, privateKey);

    mock.method(S3Client.prototype, "send", async (command: S3Command) => {
      const { Key, Body, ContentType } = command.input;
      if (bucketFails?.(Key)) throw new Error("bucket no disponible");
      if (command instanceof PutObjectCommand) {
        bucket.set(Key, { body: Body!, contentType: ContentType });
      } else if (command instanceof DeleteObjectCommand) {
        bucket.delete(Key);
      }
      return {};
    });
  });
  after(async () => {
    mock.restoreAll();
    await mongoose.disconnect();
    await mongo.stop();
  });
  beforeEach(async () => {
    await MealModel.deleteMany({});
    bucket.clear();
    bucketFails = undefined;
  });

  it("crea el índice { userId, localDate, capturedAt, _id } en meals", async () => {
    const indexes = await MealModel.collection.indexes();
    assert.ok(
      indexes.some(
        (index) =>
          JSON.stringify(index.key) === '{"userId":1,"localDate":1,"capturedAt":1,"_id":1}',
      ),
    );
  });

  describe("sin Redis", () => {
    const { queue, jobs } = recordingQueue();
    let app: Awaited<ReturnType<typeof startApp>>;

    before(async () => {
      app = await startApp(queue);
    });
    after(async () => {
      await app.close();
    });
    beforeEach(() => {
      jobs.length = 0;
      app.lines.length = 0;
    });

    const mealKey = (mealId: string, file: string) => `users/${userId}/meals/${mealId}/${file}`;

    it("solo con foto → 202, sube la media, crea la comida en processing y encola", async () => {
      const res = await post(app.url, mealForm());
      assert.equal(res.status, 202);
      const body = (await res.json()) as { mealId: string; status: string };
      assert.deepEqual(Object.keys(body).sort(), ["mealId", "status"]);
      assert.equal(body.status, "processing");

      const meal = await MealModel.findById(body.mealId).lean();
      assert.ok(meal);
      assert.equal(meal.status, "processing");
      assert.equal(meal.userId.toString(), userId);
      assert.deepEqual(meal.media, { photoKey: mealKey(body.mealId, "photo.jpg") });
      assert.equal(meal.note, undefined);
      assert.equal(bucket.get(meal.media.photoKey)?.contentType, "image/jpeg");

      assert.deepEqual(jobs, [{ mealId: body.mealId, requestId: REQUEST_ID }]);
      assert.ok(app.lines.some((l) => l.msg === "comida encolada" && l.mealId === body.mealId));
    });

    it("con audio y nota → 202 y guarda las dos keys y la nota", async () => {
      const res = await post(
        app.url,
        mealForm({ audio: fixtures.m4a(60), note: "  milanesa con puré " }),
      );
      assert.equal(res.status, 202);
      const { mealId } = (await res.json()) as { mealId: string };

      const meal = await MealModel.findById(mealId).lean();
      assert.deepEqual(meal?.media, {
        photoKey: mealKey(mealId, "photo.jpg"),
        audioKey: mealKey(mealId, "audio.m4a"),
      });
      assert.equal(meal?.note, "milanesa con puré");
      assert.equal(bucket.get(mealKey(mealId, "audio.m4a"))?.contentType, "audio/mp4");
      assert.deepEqual(jobs, [{ mealId, requestId: REQUEST_ID }]);
    });

    it("localDate es el día del usuario: 23:30 en Montevideo sigue siendo el 6/10", async () => {
      const res = await post(app.url, mealForm());
      const { mealId } = (await res.json()) as { mealId: string };
      const meal = await MealModel.findById(mealId).lean();
      assert.equal(meal?.localDate, "2026-10-06");
      assert.equal(meal?.capturedAt.toISOString(), NOW.toISOString());
    });

    it("el tipo se toma del contenido: un PNG declarado como JPEG se guarda como PNG", async () => {
      const res = await post(app.url, mealForm({ photo: fixtures.png() }));
      assert.equal(res.status, 202);
      const { mealId } = (await res.json()) as { mealId: string };
      assert.equal(bucket.get(mealKey(mealId, "photo.png"))?.contentType, "image/png");
    });

    it("acepta HEIC", async () => {
      const res = await post(app.url, mealForm({ photo: fixtures.heic(), photoName: "a.heic" }));
      assert.equal(res.status, 202);
    });

    const rejected: [string, () => FormData, number, string][] = [
      ["sin foto", () => mealForm({ photo: null, note: "algo" }), 400, "VALIDATION_ERROR"],
      [
        "foto de más de 8 MB",
        () => mealForm({ photo: fixtures.jpeg(8 * 1024 * 1024 + 1) }),
        413,
        "PAYLOAD_TOO_LARGE",
      ],
      [
        "un texto renombrado a .jpg",
        () => mealForm({ photo: fixtures.text() }),
        400,
        "VALIDATION_ERROR",
      ],
      [
        "audio de más de 60 s",
        () => mealForm({ audio: fixtures.m4a(61) }),
        400,
        "VALIDATION_ERROR",
      ],
      [
        "audio sin duración legible",
        () => mealForm({ audio: fixtures.m4aWithoutMoov() }),
        400,
        "VALIDATION_ERROR",
      ],
      ["audio que no es M4A", () => mealForm({ audio: fixtures.jpeg() }), 400, "VALIDATION_ERROR"],
      [
        "nota de más de 500 caracteres",
        () => mealForm({ note: "a".repeat(501) }),
        400,
        "VALIDATION_ERROR",
      ],
      [
        "un campo desconocido",
        () => mealForm({ extra: { plan: "premium" } }),
        400,
        "VALIDATION_ERROR",
      ],
      [
        "un archivo en un campo desconocido",
        () => mealForm({ extra: { video: new Blob(["x"]) } }),
        400,
        "VALIDATION_ERROR",
      ],
    ];
    for (const [name, form, status, code] of rejected) {
      it(`${name} → ${status} ${code}, sin subir ni crear nada`, async () => {
        await expectError(await post(app.url, form()), status, code);
        assert.equal(bucket.size, 0);
        assert.equal(await MealModel.countDocuments(), 0);
        assert.equal(jobs.length, 0);
      });
    }

    it("sin token → 401 UNAUTHORIZED", async () => {
      await expectError(await post(app.url, mealForm(), null), 401, "UNAUTHORIZED");
      assert.equal(bucket.size, 0);
    });

    it("si falla la subida al bucket → 503 y no se crea nada", async () => {
      bucketFails = () => true;
      await expectError(await post(app.url, mealForm()), 503, "SERVICE_UNAVAILABLE");
      assert.equal(await MealModel.countDocuments(), 0);
      assert.equal(jobs.length, 0);
      const log = app.lines.find((l) => l.msg === "no se pudo subir la media al bucket");
      assert.equal(log?.requestId, REQUEST_ID);
    });

    it("si sube la foto pero falla el audio → 503 y borra la foto", async () => {
      bucketFails = (key) => key.endsWith("audio.m4a");
      await expectError(
        await post(app.url, mealForm({ audio: fixtures.m4a(10) })),
        503,
        "SERVICE_UNAVAILABLE",
      );
      assert.equal(bucket.size, 0);
      assert.equal(await MealModel.countDocuments(), 0);
    });

    it("si falla la creación en Mongo → 500, borra la media subida y no encola", async (t) => {
      t.mock.method(MealModel, "create", async () => {
        throw new Error("mongo no disponible");
      });
      await expectError(
        await post(app.url, mealForm({ audio: fixtures.m4a(10) })),
        500,
        "INTERNAL_ERROR",
      );
      assert.equal(bucket.size, 0);
      assert.equal(jobs.length, 0);
      const log = app.lines.find((l) => l.msg?.toString().startsWith("no se pudo crear la comida"));
      assert.equal(log?.requestId, REQUEST_ID);
    });
  });

  describe("con Redis caído", () => {
    let app: Awaited<ReturnType<typeof startApp>>;
    let queue: MealAnalysisQueue;

    before(async () => {
      // Nada escucha en el puerto 1: BullMQ real, sin Redis del otro lado.
      queue = createMealAnalysisQueue({
        redisUrl: "redis://127.0.0.1:1",
        logger: captureLogger("back").logger,
      });
      app = await startApp(queue);
    });
    after(async () => {
      await app.close();
      await queue.close();
    });

    it("→ 503 rápido, la comida queda failed con su código y la media no se borra", async () => {
      const start = performance.now();
      const res = await post(app.url, mealForm());
      assert.ok(performance.now() - start < 3000, "tardó demasiado en fallar");
      await expectError(res, 503, "SERVICE_UNAVAILABLE");

      const meals = await MealModel.find().lean();
      assert.equal(meals.length, 1);
      assert.equal(meals[0].status, "failed");
      assert.deepEqual(meals[0].error, { code: ENQUEUE_FAILED });
      assert.ok(bucket.has(meals[0].media.photoKey));

      const log = app.lines.find((l) => l.msg?.toString().startsWith("no se pudo encolar"));
      assert.equal(log?.requestId, REQUEST_ID);
      assert.equal(log?.mealId, meals[0]._id.toString());
    });
  });

  // Contra un Redis real (ver back-service/README.md). Sin REDIS_TEST_URL se saltea.
  const redisUrl = process.env.REDIS_TEST_URL;
  describe("con Redis y sin Worker", { skip: !redisUrl && "falta REDIS_TEST_URL" }, () => {
    const prefix = `test-${randomUUID()}`;
    let app: Awaited<ReturnType<typeof startApp>>;
    let queue: MealAnalysisQueue;
    let connection: IORedis;
    let inspector: Queue<MealAnalysisJob>;

    before(async () => {
      queue = createMealAnalysisQueue({
        redisUrl: redisUrl!,
        logger: captureLogger("back").logger,
        prefix,
      });
      await queue.ready();
      app = await startApp(queue);
      connection = new IORedis(redisUrl!, { maxRetriesPerRequest: null });
      inspector = new Queue<MealAnalysisJob>(MEAL_ANALYSIS_QUEUE, { connection, prefix });
    });
    after(async () => {
      await inspector.obliterate({ force: true });
      await inspector.close();
      connection.disconnect();
      await app.close();
      await queue.close();
    });
    afterEach(async () => {
      await inspector.obliterate({ force: true });
    });

    it("responde 202 en menos de 1 s y el job queda esperando en la cola", async () => {
      const start = performance.now();
      const res = await post(app.url, mealForm({ audio: fixtures.m4a(30) }));
      const elapsed = performance.now() - start;
      assert.equal(res.status, 202);
      assert.ok(elapsed < 1000, `tardó ${elapsed} ms`);
      const { mealId } = (await res.json()) as { mealId: string };

      const job = await inspector.getJob(mealId);
      assert.ok(job, "no está el job");
      assert.equal(await job.getState(), "waiting");
      assert.deepEqual(job.data, { mealId, requestId: REQUEST_ID });
      assert.equal(job.opts.attempts, MEAL_ANALYSIS_JOB_OPTIONS.attempts);
      assert.deepEqual(job.opts.backoff, MEAL_ANALYSIS_JOB_OPTIONS.backoff);

      const meal = await MealModel.findById(mealId).lean();
      assert.equal(meal?.status, "processing");
    });

    it("encolar dos veces la misma comida no duplica el job", async () => {
      const mealId = new mongoose.Types.ObjectId().toString();
      await queue.enqueue({ mealId, requestId: REQUEST_ID });
      await queue.enqueue({ mealId, requestId: randomUUID() });
      assert.equal(await inspector.count(), 1);
      assert.equal((await inspector.getJob(mealId))?.data.requestId, REQUEST_ID);
    });
  });
});

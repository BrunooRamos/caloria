import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import type { NotificationPreferences } from "@caloria/shared";
import { createAnalyzeMeal, NOT_FOOD } from "../src/jobs/analyze-meal";
import { createMealAnalysisProcessor } from "../src/jobs/meal-analysis-processor";
import { createMealAnalysisHandler } from "../src/jobs/meal-analysis-worker";
import type { PushReceiptsJob } from "../src/jobs/push-receipts";
import {
  createPushReceiptsHandler,
  createPushReceiptsProcessor,
} from "../src/jobs/push-receipts-worker";
import { MealModel } from "../src/models/Meal";
import { UserModel } from "../src/models/User";
import type { MediaService } from "../src/services/media";
import { createNotificationService } from "../src/services/notifications";
import type {
  PushMessage,
  PushReceiptRef,
  PushReceiptsResult,
  PushSendResult,
  PushService,
} from "../src/services/push";
import { computeTargets } from "../src/services/targets";
import { parseVisionResponse } from "../src/services/vision";
import { captureLogger, fixtures } from "./helpers";

const REQUEST_ID = "0b6f3c1e-7d2a-4c5b-9e8f-1a2b3c4d5e6f";
const DISH = "Milanesa con puré de la abuela";
const IPHONE = "ExponentPushToken[iphone-de-cami]";
const ANDROID = "ExponentPushToken[android-de-cami]";
const profile = {
  sex: "female",
  birthDate: "2002-04-10",
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: "America/Montevideo",
} as const;

const range = (min: number, max: number) => ({ min, max });
const food = {
  isFood: true,
  analysis: {
    dish: DISH,
    items: [{ name: "Milanesa", grams: range(150, 190), kcal: range(380, 470) }],
    kcal: range(620, 780),
    macros: { protein: range(38, 46), carbs: range(50, 65), fat: range(28, 38) },
    confidence: 0.72,
  },
};

/**
 * Expo falso: por defecto acepta todo con un ticket por token. `respond` cambia el resultado,
 * `receipts` es lo que devuelve la consulta de receipts.
 */
function fakePush({
  respond,
  receipts = () => ({ ok: 0, failed: 0, pending: 0, invalid: [] }),
}: {
  respond?: (tokens: string[]) => PushSendResult;
  receipts?: (refs: PushReceiptRef[]) => PushReceiptsResult;
} = {}) {
  const sent: { tokens: string[]; message: PushMessage }[] = [];
  const checked: PushReceiptRef[][] = [];
  const push: PushService = {
    async send(tokens, message) {
      sent.push({ tokens, message });
      if (respond) return respond(tokens);
      return {
        ok: tokens.length,
        failed: 0,
        invalid: [],
        receipts: tokens.map((device, i) => ({ id: `receipt-${i}`, device })),
      };
    },
    async checkReceipts(refs) {
      checked.push(refs);
      return receipts(refs);
    },
  };
  return { push, sent, checked };
}

function fakeReceiptsQueue() {
  const jobs: PushReceiptsJob[] = [];
  return { jobs, enqueue: async (job: PushReceiptsJob) => void jobs.push(job) };
}

async function createUser({
  tokens = [IPHONE, ANDROID],
  notifications,
  email = "cami@example.com",
}: { tokens?: string[]; notifications?: Partial<NotificationPreferences>; email?: string } = {}) {
  const user = await UserModel.create({
    email,
    passwordHash: "x",
    profile,
    targets: computeTargets(profile),
    pushTokens: tokens,
    ...(notifications && { notifications }),
  });
  return user._id.toString();
}

const tokensOf = async (userId: string) =>
  (await UserModel.findById(userId, { pushTokens: 1 }).lean())?.pushTokens;

describe("back-service: avisos push", () => {
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
    await Promise.all([MealModel.deleteMany({}), UserModel.deleteMany({})]);
  });

  describe("análisis listo", () => {
    function setup(
      push = fakePush(),
      respond: (mealId: string) => unknown | Promise<unknown> = () => food,
    ) {
      const queue = fakeReceiptsQueue();
      const { logger, lines } = captureLogger("worker");
      const notifications = createNotificationService({ push: push.push, receipts: queue, logger });
      let mealId = "";
      const media: MediaService = {
        download: async () => fixtures.jpeg(64),
        upload: () => Promise.reject(new Error("no se usa")),
        remove: () => Promise.reject(new Error("no se usa")),
        removeUserMedia: () => Promise.reject(new Error("no se usa")),
        signedUrl: () => Promise.reject(new Error("no se usa")),
      };
      const processor = createMealAnalysisProcessor({
        media,
        analyze: createAnalyzeMeal({
          vision: {
            analyze: async () =>
              parseVisionResponse(JSON.stringify(await respond(mealId)), {
                model: "gpt-fake",
                promptVersion: "1.0.0",
              }),
          },
          transcriber: { model: "gpt-fake-transcribe", transcribe: async () => "" },
          // Sin comidas corregidas: el compounding no busca nada (se prueba en analyze-meal.test.ts).
          identifier: { identify: () => Promise.reject(new Error("no se usa")) },
          similarMeals: { hasCandidates: async () => false, find: async () => [] },
          notifications,
        }),
      });
      const handle = createMealAnalysisHandler(processor, logger);
      return {
        ...push,
        queue,
        lines,
        async run(userId: string) {
          const meal = await MealModel.create({
            userId,
            capturedAt: new Date(),
            localDate: "2026-10-28",
            status: "processing",
            media: { photoKey: `users/${userId}/meals/x/photo.jpg` },
          });
          mealId = meal.id;
          await handle({
            data: { mealId: meal.id, requestId: REQUEST_ID },
            attemptsMade: 0,
            opts: { attempts: 4 },
          });
          return meal.id as string;
        },
      };
    }

    it("manda un aviso a cada dispositivo, sin datos de la comida, con el mealId", async () => {
      const userId = await createUser();
      const { run, sent, queue, lines } = setup();
      const mealId = await run(userId);

      assert.equal(sent.length, 1);
      const [{ tokens, message }] = sent;
      assert.deepEqual(tokens, [IPHONE, ANDROID]);
      assert.deepEqual(message.data, { type: "analysisReady", mealId });
      // En la pantalla bloqueada no aparece ni el plato ni las kcal.
      const visible = `${message.title} ${message.body}`;
      assert.ok(!visible.includes(DISH) && !/kcal|\d/.test(visible), visible);

      // Los receipts quedan encolados para revisarlos más tarde.
      assert.deepEqual(queue.jobs, [
        {
          userId,
          type: "analysisReady",
          receipts: [
            { id: "receipt-0", device: IPHONE },
            { id: "receipt-1", device: ANDROID },
          ],
        },
      ]);

      const log = lines.find((line) => line.msg === "aviso enviado");
      assert.ok(log, JSON.stringify(lines));
      assert.equal(log.userId, userId);
      assert.equal(log.mealId, mealId);
      assert.equal(log.requestId, REQUEST_ID);
      assert.equal(log.type, "analysisReady");
      assert.equal(log.devices, 2);
      assert.equal(log.ok, 2);
      assert.equal(log.failed, 0);
      assert.equal(log.removed, 0);
      assert.equal(typeof log.durationMs, "number");
      assert.ok(!JSON.stringify(lines).includes("PushToken["), "los tokens no van al log");
    });

    it("con el tipo apagado no se manda nada", async () => {
      const userId = await createUser({ notifications: { analysisReady: false } });
      const { run, sent, lines } = setup();
      await run(userId);
      assert.equal(sent.length, 0);
      const skip = lines.find((line) => line.msg === "aviso salteado");
      assert.equal(skip?.reason, "disabled");
    });

    it("sin tokens no se manda nada", async () => {
      const userId = await createUser({ tokens: [] });
      const { run, sent, lines } = setup();
      await run(userId);
      assert.equal(sent.length, 0);
      assert.equal(lines.find((line) => line.msg === "aviso salteado")?.reason, "noDevices");
    });

    it("un usuario viejo sin `notifications` recibe el aviso", async () => {
      const userId = await createUser();
      await UserModel.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(userId) },
        { $unset: { notifications: "" } },
      );
      const { run, sent } = setup();
      await run(userId);
      assert.equal(sent.length, 1);
    });

    it("con NOT_FOOD no se manda nada", async () => {
      const userId = await createUser();
      const { run, sent } = setup(fakePush(), () => ({ isFood: false }));
      const mealId = await run(userId);
      assert.equal((await MealModel.findById(mealId).lean())?.error?.code, NOT_FOOD);
      assert.equal(sent.length, 0);
    });

    it("si la meal cambió de estado durante el análisis, no se manda nada", async () => {
      const userId = await createUser();
      const { run, sent } = setup(fakePush(), async (mealId) => {
        await MealModel.updateOne({ _id: mealId }, { $set: { status: "failed" } });
        return food;
      });
      await run(userId);
      assert.equal(sent.length, 0);
    });

    it("un job repetido sobre una meal ya ready no avisa dos veces", async () => {
      const userId = await createUser();
      const { run, sent, lines } = setup();
      const mealId = await run(userId);
      const handle = createMealAnalysisHandler(
        createMealAnalysisProcessor({
          media: { download: async () => fixtures.jpeg(64) } as unknown as MediaService,
          analyze: async () => assert.fail("no se analiza de nuevo"),
        }),
        captureLogger("worker").logger,
      );
      await handle({
        data: { mealId, requestId: REQUEST_ID },
        attemptsMade: 1,
        opts: { attempts: 4 },
      });
      assert.equal(sent.length, 1);
      assert.equal(lines.filter((line) => line.msg === "aviso enviado").length, 1);
    });

    it("si el push falla, se loguea y el job termina bien con la meal ready", async () => {
      const userId = await createUser();
      const { run, lines } = setup(
        fakePush({
          respond: () => {
            throw new Error("Expo Push respondió 503");
          },
        }),
      );
      const mealId = await run(userId);

      assert.equal((await MealModel.findById(mealId).lean())?.status, "ready");
      const error = lines.find((line) => line.msg === "aviso falló");
      assert.ok(error, JSON.stringify(lines));
      assert.equal(error.level, "error");
      assert.equal(error.devices, 2);
      assert.ok(lines.some((line) => line.msg === "job de análisis terminado"));
      assert.ok(!lines.some((line) => line.msg === "job de análisis falló"));
    });

    it("si no se pueden encolar los receipts, el aviso igual cuenta como enviado", async () => {
      const userId = await createUser();
      const { logger, lines } = captureLogger("worker");
      const notifications = createNotificationService({
        push: fakePush().push,
        receipts: { enqueue: () => Promise.reject(new Error("Redis no disponible")) },
        logger,
      });
      const outcome = await notifications.notify(userId, { type: "analysisReady", mealId: "m" });
      assert.equal(outcome, "sent");
      assert.ok(lines.some((line) => line.msg === "no se pudieron encolar los receipts del aviso"));
    });
  });

  describe("tokens inválidos", () => {
    it("DeviceNotRegistered en el ticket: el token se saca del usuario", async () => {
      const userId = await createUser();
      const other = await createUser({ email: "otra@example.com", tokens: [IPHONE] });
      const { push } = fakePush({
        respond: () => ({
          ok: 1,
          failed: 1,
          invalid: [IPHONE],
          receipts: [{ id: "r-android", device: ANDROID }],
        }),
      });
      const queue = fakeReceiptsQueue();
      const { logger, lines } = captureLogger("worker");
      const notifications = createNotificationService({ push, receipts: queue, logger });

      assert.equal(
        await notifications.notify(userId, { type: "analysisReady", mealId: "m" }),
        "sent",
      );
      assert.deepEqual(await tokensOf(userId), [ANDROID]);
      // Solo se toca el usuario del aviso.
      assert.deepEqual(await tokensOf(other), [IPHONE]);
      const log = lines.find((line) => line.msg === "aviso enviado");
      assert.equal(log?.ok, 1);
      assert.equal(log?.failed, 1);
      assert.equal(log?.removed, 1);
      assert.deepEqual(queue.jobs[0].receipts, [{ id: "r-android", device: ANDROID }]);
    });

    it("DeviceNotRegistered en el receipt: el job demorado saca el token", async () => {
      const userId = await createUser();
      const { push, checked } = fakePush({
        receipts: () => ({ ok: 1, failed: 1, pending: 0, invalid: [ANDROID] }),
      });
      const { logger, lines } = captureLogger("worker");
      const handle = createPushReceiptsHandler(createPushReceiptsProcessor(push), logger);
      const receipts = [
        { id: "r-iphone", device: IPHONE },
        { id: "r-android", device: ANDROID },
      ];
      await handle({
        data: { userId, type: "analysisReady", receipts },
        attemptsMade: 0,
        opts: { attempts: 3 },
      });

      assert.deepEqual(checked, [receipts]);
      assert.deepEqual(await tokensOf(userId), [IPHONE]);
      const log = lines.find((line) => line.msg === "receipts de push consultados");
      assert.ok(log, JSON.stringify(lines));
      assert.equal(log.userId, userId);
      assert.equal(log.type, "analysisReady");
      assert.equal(log.devices, 2);
      assert.equal(log.removed, 1);
      assert.ok(!JSON.stringify(lines).includes("PushToken["), "los tokens no van al log");
    });

    it("si la consulta de receipts falla, el job lanza para que BullMQ reintente", async () => {
      const userId = await createUser();
      const { push } = fakePush({
        receipts: () => {
          throw new Error("Expo Push respondió 503");
        },
      });
      const { logger, lines } = captureLogger("worker");
      const handle = createPushReceiptsHandler(createPushReceiptsProcessor(push), logger);
      await assert.rejects(
        handle({
          data: { userId, type: "wrappedReady", receipts: [{ id: "r", device: IPHONE }] },
          attemptsMade: 0,
          opts: { attempts: 3 },
        }),
      );
      assert.equal(
        lines.find((line) => line.msg === "consulta de receipts de push falló")?.willRetry,
        true,
      );
      assert.deepEqual(await tokensOf(userId), [IPHONE, ANDROID]);
    });
  });

  describe("Wrapped listo", () => {
    it("manda el aviso con la semana en data", async () => {
      const userId = await createUser();
      const { push, sent } = fakePush();
      const notifications = createNotificationService({
        push,
        receipts: fakeReceiptsQueue(),
        logger: captureLogger("worker").logger,
      });
      assert.equal(await notifications.notifyWrappedReady(userId, "2026-W43"), "sent");
      assert.deepEqual(sent[0].message.data, { type: "wrappedReady", week: "2026-W43" });
    });

    it("respeta la preferencia", async () => {
      const userId = await createUser({ notifications: { wrappedReady: false } });
      const { push, sent } = fakePush();
      const notifications = createNotificationService({
        push,
        receipts: fakeReceiptsQueue(),
        logger: captureLogger("worker").logger,
      });
      assert.equal(await notifications.notifyWrappedReady(userId, "2026-W43"), "disabled");
      assert.equal(sent.length, 0);
    });
  });
});

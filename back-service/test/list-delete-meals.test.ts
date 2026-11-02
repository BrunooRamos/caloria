import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, afterEach, before, describe, it, mock } from "node:test";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import { MEALS_PAGE_SIZE } from "@caloria/shared";
import type { MealListResponse } from "@caloria/shared";
import { loadStorageConfig } from "../src/config/storage";
import { createApp } from "../src/app";
import type { MealAnalysisQueue } from "../src/jobs/meal-analysis";
import { MealModel } from "../src/models/Meal";
import type { Meal, MealAnalysis, Range } from "../src/models/Meal";
import { UserModel } from "../src/models/User";
import { apiRouter } from "../src/routes";
import { createAuthService } from "../src/services/auth";
import { createMealService } from "../src/services/meals";
import { createMediaService } from "../src/services/media";
import { computeTargets } from "../src/services/targets";
import { signAccessToken } from "../src/services/tokens";
import { createUserService } from "../src/services/users";
import { captureLogger, listen, storageEnv } from "./helpers";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const REQUEST_ID = "0b6f3c1e-7d2a-4c5b-9e8f-1a2b3c4d5e6f";
const DAY = "2026-10-06";
// 08:00 del 6 de octubre en Montevideo (UTC-3).
const MORNING = Date.parse("2026-10-06T11:00:00Z");
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

/** Bucket en memoria: se intercepta el cliente S3, así se prueba el service de media real. */
const bucket = new Set<string>();
let bucketFails: ((key: string) => boolean) | undefined;

describe("back-service: GET /meals y DELETE /meals/:id", () => {
  let mongo: MongoMemoryServer;
  let url: string;
  let close: () => Promise<void>;
  let userId: string;
  let otherUserId: string;
  let token: string;
  let lines: Record<string, unknown>[];

  /** Crea una comida con su media en el bucket. `minute` son minutos desde las 8 de la mañana. */
  async function createMeal({
    minute = 0,
    owner = userId,
    audio = true,
    ...fields
  }: Partial<Meal> & {
    minute?: number;
    owner?: string;
    audio?: boolean;
  } = {}) {
    const _id = new Types.ObjectId();
    const prefix = `users/${owner}/meals/${_id.toString()}`;
    const media = {
      photoKey: `${prefix}/photo.jpg`,
      ...(audio && { audioKey: `${prefix}/audio.m4a` }),
    };
    await MealModel.create({
      _id,
      userId: owner,
      capturedAt: new Date(MORNING + minute * 60_000),
      localDate: DAY,
      status: "processing",
      media,
      transcript: "transcripcion-secreta",
      ...fields,
    });
    for (const key of Object.values(media)) bucket.add(key);
    return _id.toString();
  }

  const headers = (auth: string | null) => ({
    "x-request-id": REQUEST_ID,
    ...(auth && { authorization: auth }),
  });

  const list = (query: string, auth: string | null = `Bearer ${token}`) =>
    fetch(`${url}/api/v1/meals${query}`, { headers: headers(auth) });

  const remove = (id: string, auth: string | null = `Bearer ${token}`) =>
    fetch(`${url}/api/v1/meals/${id}`, { method: "DELETE", headers: headers(auth) });

  async function listDay(date = DAY, cursor?: string) {
    const res = await list(`?date=${date}${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(res.status, 200, await res.clone().text());
    return (await res.json()) as MealListResponse;
  }

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

    // Firmar URLs no pasa por send: solo se interceptan los borrados.
    mock.method(S3Client.prototype, "send", async (command: { input: { Key: string } }) => {
      const { Key } = command.input;
      if (bucketFails?.(Key)) throw new Error("bucket no disponible");
      if (command instanceof DeleteObjectCommand) bucket.delete(Key);
      return {};
    });

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
    bucket.clear();
    bucketFails = undefined;
    lines.length = 0;
  });

  after(async () => {
    mock.restoreAll();
    await close();
    await mongoose.disconnect();
    await mongo.stop();
  });

  describe("GET /meals?date=", () => {
    it("pagina de a 20 por cursor, por hora ascendente, sin repetir ni saltear", async () => {
      // Se insertan desordenadas; dos comidas a la misma hora se desempatan por id.
      const minutes = Array.from({ length: 25 }, (_, i) => (i * 7) % 25);
      const ids: string[] = [];
      for (const minute of minutes) ids.push(await createMeal({ minute }));
      const tie = await createMeal({ minute: 12 });
      ids.push(tie);

      const first = await listDay();
      assert.equal(first.items.length, MEALS_PAGE_SIZE);
      assert.equal(typeof first.nextCursor, "string");
      const second = await listDay(DAY, first.nextCursor!);
      assert.equal(second.items.length, 26 - MEALS_PAGE_SIZE);
      assert.equal(second.nextCursor, null);

      const listed = [...first.items, ...second.items];
      const times = listed.map((meal) => Date.parse(meal.capturedAt));
      assert.deepEqual(
        times,
        [...times].sort((a, b) => a - b),
      );
      assert.deepEqual([...listed.map((m) => m.id)].sort(), [...ids].sort());
      assert.equal(new Set(listed.map((m) => m.id)).size, listed.length);
      // Las dos de las 8:12, en orden de id.
      const at812 = listed.filter((m) => Date.parse(m.capturedAt) === MORNING + 12 * 60_000);
      assert.equal(at812.length, 2);
      assert.ok(at812[0].id < at812[1].id);
    });

    it("exactamente 20 comidas → una sola página con nextCursor null", async () => {
      for (let minute = 0; minute < MEALS_PAGE_SIZE; minute++) await createMeal({ minute });
      const page = await listDay();
      assert.equal(page.items.length, MEALS_PAGE_SIZE);
      assert.equal(page.nextCursor, null);
    });

    it("filtra por localDate (el día del usuario), no por la fecha UTC de capturedAt", async () => {
      // 23:30 del 6 en Montevideo ya es el 7 en UTC: cuenta para el 6.
      const late = await createMeal({ capturedAt: new Date("2026-10-07T02:30:00Z") });
      await createMeal({ localDate: "2026-10-07" });
      const { items } = await listDay();
      assert.deepEqual(
        items.map((m) => m.id),
        [late],
      );
    });

    it("las comidas de otro usuario en el mismo día no aparecen", async () => {
      const mine = await createMeal();
      await createMeal({ owner: otherUserId, minute: 5 });
      const { items, nextCursor } = await listDay();
      assert.deepEqual(
        items.map((m) => m.id),
        [mine],
      );
      assert.equal(nextCursor, null);
    });

    it("un día sin comidas → 200 con items vacío, sin caché", async () => {
      const res = await list(`?date=${DAY}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.deepEqual(await res.json(), { items: [], nextCursor: null });
    });

    it("cada item tiene la misma forma que GET /meals/:id, con las correcciones aplicadas", async () => {
      const at = new Date("2026-10-06T14:00:00Z");
      const comment = { tone: "roast", text: "Eso no es una porción, es una mudanza." };
      const ids = [
        await createMeal({ minute: 0 }),
        await createMeal({
          minute: 1,
          status: "ready",
          analysis,
          comment,
          corrections: [
            { field: "dish", from: analysis.dish, to: "Milanesa napolitana", at },
            { field: "kcal", from: analysis.kcal, to: r(800, 900), at },
          ],
        }),
        await createMeal({ minute: 2, status: "failed", error: { code: "NOT_FOOD" } }),
      ];
      const { items } = await listDay();
      assert.deepEqual(
        items.map((m) => m.id),
        ids,
      );
      for (const item of items) {
        const detail = (await (
          await fetch(`${url}/api/v1/meals/${item.id}`, { headers: headers(`Bearer ${token}`) })
        ).json()) as Record<string, unknown>;
        // La firma lleva la hora: se compara todo menos la URL, que se chequea aparte.
        const { photoUrl, ...rest } = item;
        const { photoUrl: detailUrl, ...detailRest } = detail;
        assert.deepEqual(rest, detailRest);
        assert.equal(new URL(photoUrl).pathname, new URL(String(detailUrl)).pathname);
      }
      const ready = items[1];
      assert.equal(ready.status, "ready");
      if (ready.status !== "ready") return;
      assert.equal(ready.dish, "Milanesa napolitana");
      assert.deepEqual(ready.kcal, r(800, 900));
      assert.deepEqual(ready.macros, analysis.macros);

      const text = JSON.stringify(items.map(({ photoUrl: _, ...rest }) => rest));
      for (const secret of [
        userId,
        "audio.m4a",
        "v1-secreto",
        "modelo-secreto",
        "transcripcion-secreta",
        "corrections",
        "_id",
      ]) {
        assert.ok(!text.includes(secret), `la respuesta incluye ${secret}`);
      }
    });

    for (const [caso, query] of [
      ["sin date", ""],
      ["date con otro formato", "?date=06-10-2026"],
      ["un día que no existe", "?date=2026-02-30"],
      ["date repetida", `?date=${DAY}&date=2026-10-07`],
      ["con un campo de más", `?date=${DAY}&userId=66f1a0000000000000000002`],
      ["cursor vacío", `?date=${DAY}&cursor=`],
      [
        "cursor que no es de la API",
        `?date=${DAY}&cursor=${Buffer.from("hola").toString("base64url")}`,
      ],
      ["cursor con un operador", `?date=${DAY}&cursor[$gt]=`],
    ] as const) {
      it(`${caso} → 400 VALIDATION_ERROR, nunca un 500`, async () => {
        await createMeal();
        await expectError(await list(query), 400, "VALIDATION_ERROR");
        assert.ok(!lines.some((line) => line.level === "error"), "logueó un error");
      });
    }

    it("sin token → 401 UNAUTHORIZED", async () => {
      await expectError(await list(`?date=${DAY}`, null), 401, "UNAUTHORIZED");
    });

    it("la consulta usa el índice { userId, localDate, capturedAt, _id } sin ordenar en memoria", async () => {
      for (let minute = 0; minute < 3; minute++) await createMeal({ minute });
      const explain = (await MealModel.find({ userId, localDate: DAY })
        .sort({ capturedAt: 1, _id: 1 })
        .limit(MEALS_PAGE_SIZE + 1)
        .explain()) as unknown as { queryPlanner: { winningPlan: unknown } };
      const plan = JSON.stringify(explain.queryPlanner.winningPlan);
      assert.ok(plan.includes("userId_1_localDate_1_capturedAt_1__id_1"), plan);
      assert.ok(!plan.includes('"stage":"SORT"'), `ordena en memoria: ${plan}`);
    });
  });

  describe("DELETE /meals/:id", () => {
    it("borra el documento, la foto y el audio → 204 sin cuerpo", async () => {
      const id = await createMeal({ status: "ready", analysis });
      const keep = await createMeal({ minute: 5 });
      const res = await remove(id);
      assert.equal(res.status, 204);
      assert.equal(await res.text(), "");

      assert.equal(await MealModel.exists({ _id: id }), null);
      for (const key of bucket) assert.ok(!key.includes(id), `quedó ${key} en el bucket`);
      // La otra comida y su media no se tocan.
      assert.ok(await MealModel.exists({ _id: keep }));
      assert.equal([...bucket].filter((key) => key.includes(keep)).length, 2);
      const { items } = await listDay();
      assert.deepEqual(
        items.map((m) => m.id),
        [keep],
      );
      assert.ok(lines.some((l) => l.msg === "comida borrada" && l.mealId === id));
    });

    it("una comida sin audio → borra la foto y el documento", async () => {
      const id = await createMeal({ audio: false });
      assert.equal((await remove(id)).status, 204);
      assert.equal(bucket.size, 0);
      assert.equal(await MealModel.countDocuments(), 0);
    });

    it("dos veces → la segunda es 404", async () => {
      const id = await createMeal();
      assert.equal((await remove(id)).status, 204);
      await expectError(await remove(id), 404, "NOT_FOUND");
    });

    it("una comida de otro usuario → el mismo 404 que un id inexistente, sin tocar nada", async () => {
      const othersMeal = await createMeal({ owner: otherUserId });
      const missing = new Types.ObjectId().toString();
      const [others, inexistent] = await Promise.all([remove(othersMeal), remove(missing)]);
      const responses = await Promise.all(
        [others, inexistent].map(async (res) => ({ status: res.status, body: await res.text() })),
      );
      assert.equal(responses[0].status, 404);
      assert.deepEqual(responses[0], responses[1]);
      assert.equal((JSON.parse(responses[0].body) as Envelope).error.code, "NOT_FOUND");
      assert.ok(await MealModel.exists({ _id: othersMeal }));
      assert.equal(bucket.size, 2);
    });

    it("si el bucket falla → 503 y la comida queda; al reintentar se borra todo", async () => {
      const id = await createMeal();
      bucketFails = (key) => key.endsWith("audio.m4a");
      await expectError(await remove(id), 503, "SERVICE_UNAVAILABLE");
      assert.ok(await MealModel.exists({ _id: id }), "borró la comida sin borrar la media");
      const logged = lines.find((l) => l.level === "error");
      assert.equal(logged?.mealId, id);

      bucketFails = undefined;
      assert.equal((await remove(id)).status, 204);
      assert.equal(bucket.size, 0);
      assert.equal(await MealModel.exists({ _id: id }), null);
    });

    it("id que no es un ObjectId → 400 VALIDATION_ERROR", async () => {
      await expectError(await remove("123"), 400, "VALIDATION_ERROR");
    });

    it("sin token → 401 UNAUTHORIZED y no borra", async () => {
      const id = await createMeal();
      await expectError(await remove(id, null), 401, "UNAUTHORIZED");
      assert.ok(await MealModel.exists({ _id: id }));
    });
  });
});

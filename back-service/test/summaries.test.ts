import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, afterEach, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import { createApp } from "../src/app";
import { WeeklySummaryModel } from "../src/models/WeeklySummary";
import type { WeeklySummaryStatus } from "../src/models/WeeklySummary";
import { apiRouter } from "../src/routes";
import { createAuthService } from "../src/services/auth";
import { createSummaryService } from "../src/services/summaries";
import { signAccessToken } from "../src/services/tokens";
import { createUserService } from "../src/services/users";
import { captureLogger, listen, createOwner } from "./helpers";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const REQUEST_ID = "0b6f3c1e-7d2a-4c5b-9e8f-1a2b3c4d5e6f";
const WEEK = "2026-W43";
const GENERATED_AT = new Date("2026-10-26T09:00:12Z");
const metrics = { avgKcal: 1840, daysLogged: 6, streak: 5, topDish: "Milanesa con puré" };
const insights = [
  "Registraste 6 de los 7 días.",
  "De martes a sábado no cortaste la racha.",
  "La milanesa con puré fue la que más se repitió.",
];

type Envelope = { error: { code: string; message: string; requestId: string } };

describe("back-service: GET /summaries/weekly/:week", () => {
  let mongo: MongoMemoryServer;
  let url: string;
  let close: () => Promise<void>;
  const userId = new Types.ObjectId();
  const otherUserId = new Types.ObjectId();
  const token = signAccessToken({ sub: userId.toString(), plan: "free" }, privateKey);

  const createSummary = (
    fields: { userId?: Types.ObjectId; week?: string; status?: WeeklySummaryStatus } = {},
  ) => {
    const status = fields.status ?? "ready";
    return WeeklySummaryModel.create({
      userId,
      week: WEEK,
      status,
      ...(status === "ready" && {
        metrics,
        insights,
        promptVersion: "1.0.0",
        generatedAt: GENERATED_AT,
      }),
      ...fields,
    });
  };

  const get = (week: string, auth: string | null = `Bearer ${token}`) =>
    fetch(`${url}/api/v1/summaries/weekly/${week}`, {
      headers: { "x-request-id": REQUEST_ID, ...(auth && { authorization: auth }) },
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
    await WeeklySummaryModel.init();
    await createOwner({ _id: userId });
    const api = apiRouter({
      auth: createAuthService({ privateKey }),
      users: createUserService(),
      summaries: createSummaryService(),
      publicKey,
    });
    ({ url, close } = await listen(createApp({ logger: captureLogger("back").logger, api })));
  });

  afterEach(async () => {
    await WeeklySummaryModel.deleteMany({});
  });

  after(async () => {
    await close();
    await mongoose.disconnect();
    await mongo.stop();
  });

  it("devuelve el Wrapped con la forma de api.md, sin campos internos y sin caché", async () => {
    await createSummary();
    const res = await get(WEEK);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), {
      week: WEEK,
      from: "2026-10-19",
      to: "2026-10-25",
      metrics,
      insights,
      generatedAt: "2026-10-26T09:00:12.000Z",
    });
  });

  it("from y to de una W53 cruzan el año", async () => {
    await createSummary({ week: "2026-W53" });
    const body = (await (await get("2026-W53")).json()) as Record<string, unknown>;
    assert.equal(body.from, "2026-12-28");
    assert.equal(body.to, "2027-01-03");
  });

  it("el de otro usuario y uno inexistente dan el mismo 404", async () => {
    await createSummary({ userId: otherUserId });
    const ajeno = await get(WEEK);
    const inexistente = await get("2026-W10");
    await expectError(ajeno, 404, "NOT_FOUND");
    await expectError(inexistente, 404, "NOT_FOUND");
  });

  for (const status of ["pending", "failed"] as const) {
    it(`un resumen ${status} es 404`, async () => {
      await createSummary({ status });
      await expectError(await get(WEEK), 404, "NOT_FOUND");
    });
  }

  for (const [caso, week] of [
    ["W54", "2026-W54"],
    ["W53 en un año de 52", "2025-W53"],
    ["W00", "2026-W00"],
    ["formato roto", "2026-43"],
    ["minúscula", "2026-w43"],
    ["una fecha", "2026-10-26"],
  ] as const) {
    it(`week inválido (${caso}) → 400 VALIDATION_ERROR`, async () => {
      await expectError(await get(week), 400, "VALIDATION_ERROR");
    });
  }

  it("sin token → 401", async () => {
    await createSummary();
    await expectError(await get(WEEK, null), 401, "UNAUTHORIZED");
  });
});

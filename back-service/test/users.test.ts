import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import type { MeResponse } from "@caloria/shared";
import { createApp } from "../src/app";
import { UserModel as User } from "../src/models/User";
import { apiRouter } from "../src/routes";
import { createAuthService } from "../src/services/auth";
import { signAccessToken } from "../src/services/tokens";
import { computeTargets } from "../src/services/targets";
import { createUserService } from "../src/services/users";
import { captureLogger, listen } from "./helpers";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PASSWORD = randomBytes(12).toString("base64url");
const profile = {
  sex: "female",
  birthDate: "2002-04-10",
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: "America/Montevideo",
} as const;

type Envelope = { error: { code: string } };

function yearsAgo(years: number, days = 0): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe("back-service: GET y PATCH /users/me", () => {
  const { logger } = captureLogger("back");
  let mongo: MongoMemoryServer;
  let url: string;
  let close: () => Promise<void>;
  let token: string;
  let userId: string;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await User.init();
    const auth = createAuthService({ privateKey });
    const api = apiRouter({ auth, users: createUserService(), publicKey });
    ({ url, close } = await listen(createApp({ logger, api })));
  });
  after(async () => {
    await close();
    await mongoose.disconnect();
    await mongo.stop();
  });
  beforeEach(async () => {
    await User.deleteMany({});
    const res = await fetch(`${url}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "cami@example.com", password: PASSWORD, profile }),
    });
    ({
      accessToken: token,
      user: { id: userId },
    } = (await res.json()) as { accessToken: string; user: { id: string } });
  });

  const getMe = (headers: Record<string, string> = { authorization: `Bearer ${token}` }) =>
    fetch(`${url}/api/v1/users/me`, { headers });
  const patchMe = (body: unknown, auth = `Bearer ${token}`) =>
    fetch(`${url}/api/v1/users/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify(body),
    });
  const codeOf = async (res: Response) => ((await res.json()) as Envelope).error.code;

  it("GET devuelve perfil, metas, tono y plan, sin datos sensibles", async () => {
    const res = await getMe();
    assert.equal(res.status, 200);
    const me = (await res.json()) as MeResponse;
    assert.equal(me.id, userId);
    assert.equal(me.email, "cami@example.com");
    assert.deepEqual(me.profile, profile);
    assert.deepEqual(me.targets, computeTargets(profile));
    assert.equal(me.tone, "motivador");
    assert.equal(me.plan.tier, "free");
    assert.ok(!Number.isNaN(Date.parse(me.plan.since)));
    assert.deepEqual(Object.keys(me).sort(), ["email", "id", "plan", "profile", "targets", "tone"]);
    for (const leak of ["passwordHash", "sessions", "tokenHash", "usage", "pushTokens"]) {
      assert.ok(!JSON.stringify(me).includes(leak), `la respuesta filtra ${leak}`);
    }
  });

  it("PATCH recalcula las metas, las devuelve y las guarda", async () => {
    const res = await patchMe({ profile: { weightKg: 80, goal: "lose" } });
    assert.equal(res.status, 200);
    const me = (await res.json()) as MeResponse;
    const expectedProfile = { ...profile, weightKg: 80, goal: "lose" } as const;
    assert.deepEqual(me.profile, expectedProfile);
    assert.deepEqual(me.targets, computeTargets(expectedProfile));
    assert.notDeepEqual(me.targets, computeTargets(profile));

    const stored = await User.findById(userId).lean();
    assert.deepEqual(stored?.profile, expectedProfile);
    assert.deepEqual(stored?.targets, me.targets);
    assert.deepEqual(await (await getMe()).json(), me);
  });

  it("PATCH de un campo que no afecta las metas (timezone) no las cambia", async () => {
    const res = await patchMe({ profile: { timezone: "Europe/Madrid" } });
    const me = (await res.json()) as MeResponse;
    assert.equal(me.profile.timezone, "Europe/Madrid");
    assert.deepEqual(me.targets, computeTargets(profile));
  });

  it("PATCH fuera de rango → 400 VALIDATION_ERROR y no toca nada", async () => {
    const invalid = [
      { heightCm: 99 },
      { heightCm: 251 },
      { weightKg: 29.9 },
      { weightKg: 301 },
      { birthDate: yearsAgo(16, 1) },
      { birthDate: yearsAgo(101) },
      { activity: "couch" },
      { goal: "bulk" },
      { sex: "other" },
      { timezone: "Marte/Olympus" },
      { weightKg: "70" },
    ];
    for (const changes of invalid) {
      const res = await patchMe({ profile: changes });
      assert.equal(res.status, 400, JSON.stringify(changes));
      assert.equal(await codeOf(res), "VALIDATION_ERROR");
    }
    const stored = await User.findById(userId).lean();
    assert.deepEqual(stored?.profile, profile);
    assert.deepEqual(stored?.targets, computeTargets(profile));
  });

  it("PATCH acepta los extremos del rango", async () => {
    for (const changes of [
      { heightCm: 100, weightKg: 30, birthDate: yearsAgo(16) },
      { heightCm: 250, weightKg: 300, birthDate: yearsAgo(100) },
    ]) {
      const res = await patchMe({ profile: changes });
      assert.equal(res.status, 200, JSON.stringify(changes));
    }
  });

  it("PATCH vacío, con campos desconocidos o sin JSON válido → 400", async () => {
    for (const body of [{}, { profile: {} }, { profile: { weight: 70 } }, { plan: "premium" }]) {
      const res = await patchMe(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(await codeOf(res), "VALIDATION_ERROR");
    }
    const res = await fetch(`${url}/api/v1/users/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: "{no es json",
    });
    assert.equal(res.status, 400);
  });

  it("PATCH simultáneos: no se pierde ningún cambio y las metas corresponden al perfil final", async () => {
    const responses = await Promise.all([
      patchMe({ profile: { weightKg: 90 } }),
      patchMe({ profile: { goal: "gain" } }),
      patchMe({ profile: { activity: "very_active" } }),
    ]);
    assert.deepEqual(
      responses.map((res) => res.status),
      [200, 200, 200],
    );
    const stored = await User.findById(userId).lean();
    const expectedProfile = {
      ...profile,
      weightKg: 90,
      goal: "gain",
      activity: "very_active",
    } as const;
    assert.deepEqual(stored?.profile, expectedProfile);
    assert.deepEqual(stored?.targets, computeTargets(expectedProfile));
  });

  it("un usuario nuevo arranca con el tono motivador", async () => {
    assert.equal((await User.findById(userId).lean())?.tone, "motivador");
  });

  it("PATCH solo con tone guarda el tono sin tocar perfil ni metas", async () => {
    const before = await User.findById(userId).lean();
    const res = await patchMe({ tone: "roast" });
    assert.equal(res.status, 200);
    const me = (await res.json()) as MeResponse;
    assert.equal(me.tone, "roast");
    assert.deepEqual(me.profile, profile);
    assert.deepEqual(me.targets, computeTargets(profile));
    assert.deepEqual(Object.keys(me).sort(), ["email", "id", "plan", "profile", "targets", "tone"]);

    const stored = await User.findById(userId).lean();
    assert.equal(stored?.tone, "roast");
    assert.deepEqual(stored?.profile, before?.profile);
    assert.deepEqual(stored?.targets, before?.targets);
    assert.deepEqual(await (await getMe()).json(), me);
  });

  it("PATCH con profile y tone guarda los dos y recalcula las metas", async () => {
    const res = await patchMe({ profile: { weightKg: 80, goal: "lose" }, tone: "off" });
    assert.equal(res.status, 200);
    const me = (await res.json()) as MeResponse;
    const expectedProfile = { ...profile, weightKg: 80, goal: "lose" } as const;
    assert.equal(me.tone, "off");
    assert.deepEqual(me.profile, expectedProfile);
    assert.deepEqual(me.targets, computeTargets(expectedProfile));

    const stored = await User.findById(userId).lean();
    assert.equal(stored?.tone, "off");
    assert.deepEqual(stored?.profile, expectedProfile);
    assert.deepEqual(stored?.targets, me.targets);
  });

  it("PATCH con tono inválido → 400 y no toca nada, aunque venga con un perfil válido", async () => {
    for (const body of [
      { tone: "sarcastico" },
      { tone: null },
      { tone: "" },
      { profile: { weightKg: 80 }, tone: "sarcastico" },
      { tone: "roast", pushTokens: [] },
    ]) {
      const res = await patchMe(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(await codeOf(res), "VALIDATION_ERROR");
    }
    const stored = await User.findById(userId).lean();
    assert.equal(stored?.tone, "motivador");
    assert.deepEqual(stored?.profile, profile);
    assert.deepEqual(stored?.targets, computeTargets(profile));
  });

  it("PATCH de tono y de perfil simultáneos: se guardan los dos", async () => {
    const responses = await Promise.all([
      patchMe({ profile: { weightKg: 90 } }),
      patchMe({ tone: "neutro" }),
      patchMe({ profile: { goal: "gain" } }),
    ]);
    assert.deepEqual(
      responses.map((res) => res.status),
      [200, 200, 200],
    );
    const stored = await User.findById(userId).lean();
    const expectedProfile = { ...profile, weightKg: 90, goal: "gain" } as const;
    assert.equal(stored?.tone, "neutro");
    assert.deepEqual(stored?.profile, expectedProfile);
    assert.deepEqual(stored?.targets, computeTargets(expectedProfile));
  });

  it("sin token, con token inválido o de otra clave → 401 UNAUTHORIZED", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const forged = signAccessToken({ sub: userId, plan: "premium" }, other);
    const cases: Record<string, string>[] = [
      {},
      { authorization: token },
      { authorization: "Bearer " },
      { authorization: "Bearer basura" },
      { authorization: `Bearer ${forged}` },
    ];
    for (const headers of cases) {
      const res = await getMe(headers);
      assert.equal(res.status, 401, JSON.stringify(headers));
      assert.equal(await codeOf(res), "UNAUTHORIZED");
    }
    const res = await patchMe({ profile: { weightKg: 80 } }, `Bearer ${forged}`);
    assert.equal(res.status, 401);
    assert.equal((await User.findById(userId).lean())?.profile.weightKg, 60);
  });

  it("token vencido → 401 TOKEN_EXPIRED", async () => {
    const expired = jwt.sign({ plan: "free" }, privateKey, {
      algorithm: "RS256",
      subject: userId,
      expiresIn: -10,
    });
    const res = await getMe({ authorization: `Bearer ${expired}` });
    assert.equal(res.status, 401);
    assert.equal(await codeOf(res), "TOKEN_EXPIRED");
  });

  it("token válido de un usuario borrado o con sub que no es ObjectId → 401", async () => {
    const notObjectId = signAccessToken({ sub: "no-es-un-id", plan: "free" }, privateKey);
    let res = await getMe({ authorization: `Bearer ${notObjectId}` });
    assert.equal(res.status, 401);

    await User.deleteMany({});
    res = await getMe();
    assert.equal(res.status, 401);
    assert.equal(await codeOf(res), "UNAUTHORIZED");
    res = await patchMe({ profile: { weightKg: 80 } });
    assert.equal(res.status, 401);
    res = await patchMe({ tone: "roast" });
    assert.equal(res.status, 401);
    assert.equal(await codeOf(res), "UNAUTHORIZED");
  });

  it("cada usuario ve y edita solo su propio perfil", async () => {
    const res = await fetch(`${url}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "otra@example.com",
        password: PASSWORD,
        profile: { ...profile, sex: "male" },
      }),
    });
    const other = (await res.json()) as { accessToken: string };
    await patchMe({ profile: { weightKg: 99 } }, `Bearer ${other.accessToken}`);

    const me = (await (await getMe()).json()) as MeResponse;
    assert.equal(me.email, "cami@example.com");
    assert.equal(me.profile.weightKg, 60);
  });
});

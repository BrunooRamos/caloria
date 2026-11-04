import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { DEFAULT_NOTIFICATIONS, MAX_PUSH_TOKENS } from "@caloria/shared";
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
    assert.deepEqual(me.notifications, DEFAULT_NOTIFICATIONS);
    assert.deepEqual(Object.keys(me).sort(), [
      "email",
      "id",
      "notifications",
      "plan",
      "profile",
      "targets",
      "tone",
    ]);
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
    assert.deepEqual(Object.keys(me).sort(), [
      "email",
      "id",
      "notifications",
      "plan",
      "profile",
      "targets",
      "tone",
    ]);

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
      { tone: "roast", plan: "premium" },
      { tone: "roast", pushTokens: ["no-es-un-token"] },
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

  describe("push tokens", () => {
    const token = (id: string) => `ExponentPushToken[${id}]`;
    const storedTokens = async (id = userId) =>
      (await User.findById(id, { pushTokens: 1 }).lean())?.pushTokens;

    async function registerOther(email: string) {
      const res = await fetch(`${url}/api/v1/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD, profile }),
      });
      return (await res.json()) as { accessToken: string; user: { id: string } };
    }

    it("un token nuevo se suma sin pisar los de los otros dispositivos", async () => {
      assert.equal((await patchMe({ pushTokens: [token("iphone")] })).status, 200);
      const res = await patchMe({ pushTokens: [token("android")] });
      assert.equal(res.status, 200);
      assert.deepEqual(await storedTokens(), [token("iphone"), token("android")]);
      // La respuesta nunca trae los tokens.
      assert.ok(!JSON.stringify(await res.json()).includes("PushToken"));
    });

    it("un token repetido no se duplica: pasa a ser el más nuevo", async () => {
      await patchMe({ pushTokens: [token("a"), token("b")] });
      await patchMe({ pushTokens: [token("a")] });
      await patchMe({ pushTokens: [token("b")] });
      assert.deepEqual(await storedTokens(), [token("a"), token("b")]);
      await patchMe({ pushTokens: [token("a")] });
      assert.deepEqual(await storedTokens(), [token("b"), token("a")]);
    });

    it(`quedan como mucho ${MAX_PUSH_TOKENS}: se sacan los más viejos`, async () => {
      const first = Array.from({ length: MAX_PUSH_TOKENS }, (_, i) => token(`viejo${i}`));
      await patchMe({ pushTokens: first });
      await patchMe({ pushTokens: [token("nuevo1"), token("nuevo2")] });
      assert.deepEqual(await storedTokens(), [...first.slice(2), token("nuevo1"), token("nuevo2")]);
    });

    it("funciona con usuarios viejos que no tienen el campo", async () => {
      await User.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(userId) },
        { $unset: { pushTokens: "" } },
      );
      assert.equal((await patchMe({ pushTokens: [token("a")] })).status, 200);
      assert.deepEqual(await storedTokens(), [token("a")]);
    });

    it("un token que estaba en otra cuenta se le saca a esa", async () => {
      const other = await registerOther("otra@example.com");
      await patchMe(
        { pushTokens: [token("compartido"), token("suyo")] },
        `Bearer ${other.accessToken}`,
      );

      assert.equal((await patchMe({ pushTokens: [token("compartido")] })).status, 200);
      assert.deepEqual(await storedTokens(), [token("compartido")]);
      assert.deepEqual(await storedTokens(other.user.id), [token("suyo")]);
    });

    it("PATCH simultáneos de dos dispositivos y del perfil: no se pierde nada", async () => {
      const responses = await Promise.all([
        patchMe({ pushTokens: [token("iphone")] }),
        patchMe({ pushTokens: [token("android")] }),
        patchMe({ profile: { weightKg: 70 } }),
        patchMe({ notifications: { streakRisk: false } }),
      ]);
      assert.deepEqual(
        responses.map((res) => res.status),
        [200, 200, 200, 200],
      );
      const stored = await User.findById(userId).lean();
      assert.deepEqual([...(stored?.pushTokens ?? [])].sort(), [token("android"), token("iphone")]);
      assert.equal(stored?.profile.weightKg, 70);
      assert.equal(stored?.notifications?.streakRisk, false);
    });

    it("tokens inválidos, repetidos o de más → 400 y no se guarda nada", async () => {
      for (const pushTokens of [
        ["no-es-un-token"],
        [token("a"), token("a")],
        Array.from({ length: MAX_PUSH_TOKENS + 1 }, (_, i) => token(`t${i}`)),
      ]) {
        const res = await patchMe({ pushTokens });
        assert.equal(res.status, 400, JSON.stringify(pushTokens));
        assert.equal(await codeOf(res), "VALIDATION_ERROR");
      }
      assert.deepEqual(await storedTokens(), []);
    });
  });

  describe("preferencias de avisos", () => {
    it("un cambio parcial cambia solo ese tipo y sale en la respuesta y en el GET", async () => {
      const res = await patchMe({ notifications: { streakRisk: false } });
      assert.equal(res.status, 200);
      const expected = { ...DEFAULT_NOTIFICATIONS, streakRisk: false };
      assert.deepEqual(((await res.json()) as MeResponse).notifications, expected);
      assert.deepEqual(((await (await getMe()).json()) as MeResponse).notifications, expected);

      await patchMe({ notifications: { wrappedReady: false } });
      await patchMe({ notifications: { streakRisk: true } });
      const me = (await (await getMe()).json()) as MeResponse;
      assert.deepEqual(me.notifications, { ...DEFAULT_NOTIFICATIONS, wrappedReady: false });
    });

    it("un usuario viejo sin el campo tiene todo prendido y puede cambiarlo", async () => {
      await User.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(userId) },
        { $unset: { notifications: "" } },
      );
      let me = (await (await getMe()).json()) as MeResponse;
      assert.deepEqual(me.notifications, DEFAULT_NOTIFICATIONS);

      await patchMe({ notifications: { analysisReady: false } });
      me = (await (await getMe()).json()) as MeResponse;
      assert.deepEqual(me.notifications, { ...DEFAULT_NOTIFICATIONS, analysisReady: false });
    });

    it("un tipo desconocido, vacío o que no es booleano → 400 y no toca nada", async () => {
      for (const notifications of [{}, { promo: true }, { streakRisk: "no" }, null]) {
        const res = await patchMe({ notifications });
        assert.equal(res.status, 400, JSON.stringify(notifications));
        assert.equal(await codeOf(res), "VALIDATION_ERROR");
      }
      const res = await patchMe({ notifications: { streakRisk: false, promo: true } });
      assert.equal(res.status, 400);
      const me = (await (await getMe()).json()) as MeResponse;
      assert.deepEqual(me.notifications, DEFAULT_NOTIFICATIONS);
    });

    it("perfil y avisos en el mismo PATCH se guardan juntos", async () => {
      const res = await patchMe({
        profile: { weightKg: 75 },
        notifications: { wrappedReady: false },
      });
      const me = (await res.json()) as MeResponse;
      assert.equal(me.profile.weightKg, 75);
      assert.equal(me.notifications.wrappedReady, false);
      assert.deepEqual(me.targets, computeTargets({ ...profile, weightKg: 75 }));
    });
  });
});

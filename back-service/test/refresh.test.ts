import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { verifyAccessToken } from "@caloria/shared";
import { createApp } from "../src/app";
import { UserModel as User } from "../src/models/User";
import { apiRouter } from "../src/routes";
import { createAuthService, MAX_SESSIONS } from "../src/services/auth";
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
};

type Envelope = { error: { code: string; message: string; requestId: string } };
type Tokens = { accessToken: string; refreshToken: string; user: { id: string; email: string } };

const sha256 = (token: string) => createHash("sha256").update(token).digest("hex");

describe("back-service: POST /auth/refresh y /auth/logout", () => {
  const { logger, lines } = captureLogger("back");
  let mongo: MongoMemoryServer;
  let url: string;
  let close: () => Promise<void>;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await User.init();
    const auth = createAuthService({ privateKey });
    ({ url, close } = await listen(createApp({ logger, api: apiRouter({ auth, publicKey }) })));
  });
  after(async () => {
    await close();
    await mongoose.disconnect();
    await mongo.stop();
  });
  beforeEach(async () => {
    lines.length = 0;
    await User.deleteMany({});
  });

  const post = (path: string, body: unknown, accessToken?: string) =>
    fetch(`${url}/api/v1/auth/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(accessToken && { authorization: `Bearer ${accessToken}` }),
      },
      body: JSON.stringify(body),
    });
  const register = async (email = "cami@example.com") =>
    (await (await post("register", { email, password: PASSWORD, profile })).json()) as Tokens;
  const login = async (email = "cami@example.com") =>
    (await (await post("login", { email, password: PASSWORD })).json()) as Tokens;
  const refresh = (refreshToken: string) => post("refresh", { refreshToken });
  const logout = (accessToken: string, refreshToken: string) =>
    post("logout", { refreshToken }, accessToken);
  const sessionOf = async (refreshToken: string) => {
    const user = await User.findOne({ "sessions.tokenHash": sha256(refreshToken) }).lean();
    return user?.sessions.find((s) => s.tokenHash === sha256(refreshToken));
  };
  const errorOf = async (res: Response) => ((await res.json()) as Envelope).error;

  it("refresh → 200 con un par nuevo de la misma familia y el usado queda rotado", async () => {
    const first = await register();
    const res = await refresh(first.refreshToken);
    assert.equal(res.status, 200);
    const next = (await res.json()) as Tokens;
    assert.deepEqual(Object.keys(next).sort(), ["accessToken", "refreshToken", "user"]);
    assert.deepEqual(next.user, first.user);
    assert.notEqual(next.refreshToken, first.refreshToken);
    assert.deepEqual(verifyAccessToken(next.accessToken, publicKey), {
      sub: first.user.id,
      plan: "free",
    });

    const used = await sessionOf(first.refreshToken);
    const created = await sessionOf(next.refreshToken);
    assert.ok(used?.rotatedAt, "el refresh usado se marca como rotado, no se borra");
    assert.equal(used?.revokedAt, undefined);
    assert.equal(created?.family, used?.family);
    assert.equal(created?.rotatedAt, undefined);
    const days = (created!.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    assert.ok(days > 29.9 && days <= 30, `expira en ${days} días`);
  });

  it("después de rotar, el refresh viejo deja de servir y el nuevo funciona", async () => {
    const first = await register();
    const second = (await (await refresh(first.refreshToken)).json()) as Tokens;
    const third = await refresh(second.refreshToken);
    assert.equal(third.status, 200);
    const { refreshToken } = (await third.json()) as Tokens;
    assert.equal((await refresh(refreshToken)).status, 200);
  });

  it("reuso de un refresh rotado → 401 y se revoca toda la familia, incluido el más nuevo", async () => {
    const first = await register();
    const second = (await (await refresh(first.refreshToken)).json()) as Tokens;

    const reuse = await refresh(first.refreshToken);
    assert.equal(reuse.status, 401);
    assert.equal((await errorOf(reuse)).code, "UNAUTHORIZED");

    const stored = await User.findById(first.user.id).lean();
    assert.ok(stored?.sessions.length);
    assert.ok(
      stored.sessions.every((s) => s.revokedAt),
      "toda la familia queda revocada",
    );
    assert.equal((await refresh(second.refreshToken)).status, 401);
  });

  it("el reuso deja un warning con userId y familia, sin el token", async () => {
    const first = await register();
    const second = (await (await refresh(first.refreshToken)).json()) as Tokens;
    const { family } = (await sessionOf(first.refreshToken))!;
    await refresh(first.refreshToken);

    const warning = lines.find((l) => l.level === "warn" && String(l.msg).includes("reuso"));
    assert.ok(warning, "falta el warning de reuso");
    assert.equal(warning.userId, first.user.id);
    assert.equal(warning.family, family);
    const logs = JSON.stringify(lines);
    for (const token of [first.refreshToken, second.refreshToken, sha256(first.refreshToken)]) {
      assert.ok(!logs.includes(token), "el log filtra el refresh o su hash");
    }
  });

  it("el reuso no toca las otras familias del mismo usuario (otro dispositivo)", async () => {
    const phone = await register();
    const tablet = await login();
    await refresh(phone.refreshToken);
    assert.equal((await refresh(phone.refreshToken)).status, 401);

    const tabletSession = await sessionOf(tablet.refreshToken);
    assert.equal(tabletSession?.revokedAt, undefined);
    assert.equal((await refresh(tablet.refreshToken)).status, 200);
  });

  it("inválido, inexistente, vencido, revocado o reusado: el mismo 401 con el mismo mensaje", async () => {
    const { user, refreshToken } = await register();
    await refresh(refreshToken); // queda rotado

    const expired = randomBytes(32).toString("base64url");
    await User.updateOne(
      { _id: user.id },
      {
        $push: {
          sessions: {
            tokenHash: sha256(expired),
            family: "vieja",
            expiresAt: new Date(Date.now() - 1000),
          },
        },
      },
    );

    const errors = [];
    for (const token of [randomBytes(32).toString("base64url"), expired, refreshToken]) {
      const res = await refresh(token);
      assert.equal(res.status, 401);
      const { code, message } = await errorOf(res);
      errors.push({ code, message });
    }
    // Revocado: después del reuso, la familia entera.
    const revoked = await refresh(refreshToken);
    assert.equal(revoked.status, 401);
    const { code, message } = await errorOf(revoked);
    errors.push({ code, message });

    for (const error of errors) assert.deepEqual(error, errors[0]);
    assert.equal(errors[0].code, "UNAUTHORIZED");
  });

  it("refresh vencido → 401 y no se trata como reuso", async () => {
    const { user } = await register();
    const expired = randomBytes(32).toString("base64url");
    await User.updateOne(
      { _id: user.id },
      {
        $push: {
          sessions: {
            tokenHash: sha256(expired),
            family: "vencida",
            expiresAt: new Date(Date.now() - 1000),
            rotatedAt: new Date(Date.now() - 2000),
          },
        },
      },
    );
    assert.equal((await refresh(expired)).status, 401);
    assert.ok(!lines.some((l) => l.level === "warn" && String(l.msg).includes("reuso")));
    const stored = await User.findById(user.id).lean();
    assert.ok(stored?.sessions.every((s) => !s.revokedAt));
  });

  it("body sin refreshToken → 400 VALIDATION_ERROR", async () => {
    for (const body of [{}, { refreshToken: "" }, { refreshToken: 1 }]) {
      const res = await post("refresh", body);
      assert.equal(res.status, 400);
      assert.equal((await errorOf(res)).code, "VALIDATION_ERROR");
    }
  });

  it("el access nuevo lleva el plan actual de la base, no el del access anterior", async () => {
    const { user, accessToken, refreshToken } = await register();
    assert.equal(verifyAccessToken(accessToken, publicKey).plan, "free");
    await User.updateOne({ _id: user.id }, { $set: { "plan.tier": "premium" } });
    const next = (await (await refresh(refreshToken)).json()) as Tokens;
    assert.equal(verifyAccessToken(next.accessToken, publicKey).plan, "premium");
  });

  it("dos refresh simultáneos con el mismo token: uno 200, otro 401 y la familia queda revocada", async () => {
    const { user, refreshToken } = await register();
    const responses = await Promise.all([refresh(refreshToken), refresh(refreshToken)]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 401]);

    const winner = (await responses.find((r) => r.status === 200)!.json()) as Tokens;
    const stored = await User.findById(user.id).lean();
    assert.equal(stored?.sessions.length, 2);
    assert.ok(stored?.sessions.every((s) => s.revokedAt));
    assert.equal((await refresh(winner.refreshToken)).status, 401);
  });

  it("las sesiones rotadas no desplazan a las activas de otros dispositivos", async () => {
    const tablet = await register();
    let { refreshToken } = await login();
    for (let i = 0; i < MAX_SESSIONS + 5; i++) {
      const res = await refresh(refreshToken);
      assert.equal(res.status, 200);
      ({ refreshToken } = (await res.json()) as Tokens);
    }
    assert.equal((await refresh(tablet.refreshToken)).status, 200);
  });

  it("al rotar se descartan las sesiones vencidas", async () => {
    const { user, refreshToken } = await register();
    const old = { tokenHash: "viejo", family: "f", expiresAt: new Date(Date.now() - 1000) };
    await User.updateOne({ _id: user.id }, { $push: { sessions: old } });
    await refresh(refreshToken);
    const stored = await User.findById(user.id).lean();
    assert.ok(stored?.sessions.every((s) => s.expiresAt.getTime() > Date.now()));
    assert.equal(stored?.sessions.length, 2);
  });

  it("logout → 204, revoca la familia y el refresh deja de servir", async () => {
    const first = await register();
    const second = (await (await refresh(first.refreshToken)).json()) as Tokens;
    const res = await logout(second.accessToken, second.refreshToken);
    assert.equal(res.status, 204);
    assert.equal(await res.text(), "");

    const stored = await User.findById(first.user.id).lean();
    assert.ok(stored?.sessions.length === 2 && stored.sessions.every((s) => s.revokedAt));
    assert.equal((await refresh(second.refreshToken)).status, 401);
  });

  it("logout no toca las otras familias del mismo usuario", async () => {
    const phone = await register();
    const tablet = await login();
    assert.equal((await logout(phone.accessToken, phone.refreshToken)).status, 204);
    assert.equal((await sessionOf(tablet.refreshToken))?.revokedAt, undefined);
    assert.equal((await refresh(tablet.refreshToken)).status, 200);
  });

  it("logout con el refresh de otro usuario → 204 y no revoca nada", async () => {
    const cami = await register();
    const juan = await register("juan@example.com");
    assert.equal((await logout(cami.accessToken, juan.refreshToken)).status, 204);
    assert.equal((await sessionOf(juan.refreshToken))?.revokedAt, undefined);
    assert.equal((await refresh(juan.refreshToken)).status, 200);
  });

  it("logout dos veces → 204 las dos; con un refresh inexistente también", async () => {
    const { accessToken, refreshToken } = await register();
    assert.equal((await logout(accessToken, refreshToken)).status, 204);
    const { revokedAt } = (await sessionOf(refreshToken))!;
    assert.equal((await logout(accessToken, refreshToken)).status, 204);
    assert.deepEqual((await sessionOf(refreshToken))?.revokedAt, revokedAt);
    assert.equal((await logout(accessToken, randomBytes(32).toString("base64url"))).status, 204);
  });

  it("logout sin access token, con uno inválido o vencido → 401 y no revoca", async () => {
    const { user, refreshToken } = await register();
    const expired = jwt.sign({ plan: "free" }, privateKey, {
      algorithm: "RS256",
      subject: user.id,
      expiresIn: -10,
    });
    const cases: [string | undefined, string][] = [
      [undefined, "UNAUTHORIZED"],
      ["basura", "UNAUTHORIZED"],
      [expired, "TOKEN_EXPIRED"],
    ];
    for (const [accessToken, code] of cases) {
      const res = await post("logout", { refreshToken }, accessToken);
      assert.equal(res.status, 401);
      assert.equal((await errorOf(res)).code, code);
    }
    assert.equal((await sessionOf(refreshToken))?.revokedAt, undefined);
  });

  it("en la base nunca queda un refresh en texto plano", async () => {
    const issued: string[] = [];
    const phone = await register();
    const tablet = await login();
    issued.push(phone.refreshToken, tablet.refreshToken);
    const rotated = (await (await refresh(phone.refreshToken)).json()) as Tokens;
    issued.push(rotated.refreshToken);
    await refresh(phone.refreshToken); // reuso
    await logout(tablet.accessToken, tablet.refreshToken);

    const dump = JSON.stringify(await User.find().lean());
    for (const token of issued) {
      assert.ok(!dump.includes(token), "la base guarda un refresh en texto plano");
      assert.ok(dump.includes(sha256(token)), "falta el hash de un refresh emitido");
    }
  });

  it("hay índice en sessions.tokenHash", async () => {
    const indexes = await User.collection.indexes();
    assert.ok(indexes.some((index) => index.key["sessions.tokenHash"] === 1));
  });
});

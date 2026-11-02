import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { schemas } from "../src/schemas";
import type { RouteSchema } from "../src/schemas";
import { MAX_DEPTH, withoutOperatorKeys } from "../src/schemas/safe-keys";
import { MAX_PUSH_TOKENS } from "@caloria/shared";
import { updateMeRequestSchema } from "../src/schemas/users";

const token = (id: string) => `ExponentPushToken[${id}]`;

const profile = {
  sex: "female",
  birthDate: "2002-04-10",
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: "America/Montevideo",
};

function bodyOf(route: RouteSchema): z.ZodType {
  assert.ok(route.body, "la ruta no tiene esquema de body");
  return route.body;
}

const ok = (schema: z.ZodType, value: unknown) =>
  assert.equal(schema.safeParse(value).success, true, JSON.stringify(value));
const rejected = (schema: z.ZodType, value: unknown) =>
  assert.equal(schema.safeParse(value).success, false, JSON.stringify(value));

describe("PATCH /users/me: updateMeRequestSchema", () => {
  it("acepta cambios parciales de perfil, tono, push tokens y avisos, juntos o por separado", () => {
    ok(updateMeRequestSchema, { profile: { weightKg: 58, goal: "lose" } });
    ok(updateMeRequestSchema, { tone: "roast" });
    ok(updateMeRequestSchema, { pushTokens: [token("abc_DEF-123"), "ExpoPushToken[xyz]"] });
    ok(updateMeRequestSchema, { notifications: { streakRisk: false } });
    ok(updateMeRequestSchema, {
      profile: { heightCm: 170 },
      tone: "off",
      pushTokens: [],
      notifications: { analysisReady: true, wrappedReady: false },
    });
  });

  it("rechaza body vacío, perfil vacío, campos desconocidos y fuera de rango", () => {
    for (const body of [
      {},
      { profile: {} },
      { plan: "premium" },
      { tone: "neutro", plan: "premium" },
      { profile: { weight: 70 } },
      { profile: { heightCm: 99 } },
      { profile: { weightKg: 301 } },
      { profile: { timezone: "Marte/Olympus" } },
      { profile: { birthDate: `${new Date().getUTCFullYear() - 15}-01-01` } },
    ]) {
      rejected(updateMeRequestSchema, body);
    }
  });

  it("rechaza tonos, push tokens y avisos inválidos", () => {
    for (const body of [
      { tone: "sarcastico" },
      { tone: null },
      { pushTokens: "ExponentPushToken[abc]" },
      { pushTokens: ["no-es-un-token"] },
      { pushTokens: ["ExponentPushToken[]"] },
      { pushTokens: [token("a"), token("a")] },
      { pushTokens: Array.from({ length: MAX_PUSH_TOKENS + 1 }, (_, i) => token(`t${i}`)) },
      { notifications: {} },
      { notifications: { mealReminder: true } },
      { notifications: { streakRisk: "false" } },
    ]) {
      rejected(updateMeRequestSchema, body);
    }
  });
});

describe("register y login: estrictos", () => {
  const register = bodyOf(schemas.register);

  it("register normaliza el email y rechaza cualquier clave de más", () => {
    const parsed = register.parse({ email: " Cami@Example.COM ", password: "12345678", profile });
    assert.equal((parsed as { email: string }).email, "cami@example.com");
    rejected(register, { email: "a@b.co", password: "12345678", profile, plan: "premium" });
    rejected(register, {
      email: "a@b.co",
      password: "12345678",
      profile: { ...profile, admin: true },
    });
  });

  it("login rechaza claves de más", () => {
    ok(bodyOf(schemas.login), { email: "a@b.co", password: "x" });
    rejected(bodyOf(schemas.login), { email: "a@b.co", password: "x", remember: true });
  });
});

describe("withoutOperatorKeys: claves con $ o .", () => {
  const anything = withoutOperatorKeys(z.unknown());

  it("rechaza claves con $ o . en la raíz, anidadas y dentro de arrays", () => {
    for (const value of [
      { $where: "1" },
      { email: { $ne: null } },
      { profile: { weightKg: { $gt: 0 } } },
      { "profile.weightKg": 58 },
      { list: [{ ok: 1 }, { $set: { plan: "premium" } }] },
      { a: { b: { c: { "d.e": 1 } } } },
    ]) {
      rejected(anything, value);
    }
  });

  it("no mira los valores: emails, zonas horarias y textos con $ o . pasan", () => {
    ok(anything, { email: "cami@example.com", timezone: "America/Montevideo", note: "$100." });
    ok(anything, ["$where", "a.b"]);
    ok(anything, undefined);
  });

  it("corta el anidamiento excesivo", () => {
    let deep: unknown = 1;
    for (let i = 0; i < MAX_DEPTH + 1; i++) deep = { a: deep };
    rejected(anything, deep);
  });

  it("se aplica a body, params y query de todas las rutas", () => {
    for (const schema of Object.values(schemas)) {
      rejected(schema.query, { $where: "1" });
      rejected(schema.params, { "a.b": "1" });
      if (schema.body) rejected(schema.body, { $where: "1" });
    }
  });
});

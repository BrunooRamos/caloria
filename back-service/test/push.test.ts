import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadWorkerConfig } from "../src/config/worker";
import {
  createExpoPush,
  DEVICE_NOT_REGISTERED,
  EXPO_MAX_MESSAGES,
  EXPO_MAX_RECEIPT_IDS,
  EXPO_RECEIPTS_URL,
  EXPO_SEND_URL,
  PushRequestError,
} from "../src/services/push";
import { storageEnv } from "./helpers";

const token = (id: string | number) => `ExponentPushToken[${id}]`;
const message = { title: "Tu comida está lista", body: "Entrá.", data: { type: "analysisReady" } };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface SentRequest {
  url: string;
  headers: Headers;
  body: unknown;
}

/** Expo falso: guarda cada request y responde con `respond`. Nunca sale a la red. */
function setup(respond: (body: unknown, url: string) => Response, accessToken?: string) {
  const requests: SentRequest[] = [];
  const push = createExpoPush({
    ...(accessToken && { accessToken }),
    fetch: async (url, init) => {
      const body: unknown = JSON.parse(String(init?.body));
      requests.push({ url: String(url), headers: new Headers(init?.headers), body });
      return respond(body, String(url));
    },
  });
  return { push, requests };
}

/** Un ticket ok por mensaje, con un id que dice a qué token corresponde. */
const okTickets = (body: unknown) =>
  json({
    data: (body as { to: string }[]).map(({ to }) => ({ status: "ok", id: `r-${to}` })),
  });

describe("back-service: service de Expo Push (sin red)", () => {
  it(`manda de a ${EXPO_MAX_MESSAGES} mensajes por request, uno por token`, async () => {
    const tokens = Array.from({ length: 250 }, (_, i) => token(i));
    const { push, requests } = setup(okTickets);

    const result = await push.send(tokens, message);

    assert.deepEqual(
      requests.map((req) => (req.body as unknown[]).length),
      [100, 100, 50],
    );
    assert.ok(requests.every((req) => req.url === EXPO_SEND_URL));
    const [first] = requests[0].body as Record<string, unknown>[];
    assert.deepEqual(first, { to: token(0), ...message, sound: "default" });
    assert.equal(result.ok, 250);
    assert.equal(result.failed, 0);
    assert.deepEqual(result.invalid, []);
    assert.deepEqual(result.receipts[249], { id: `r-${token(249)}`, device: token(249) });
  });

  it("sin EXPO_ACCESS_TOKEN no manda Authorization; con él, Bearer", async () => {
    const without = setup(okTickets);
    await without.push.send([token("a")], message);
    assert.equal(without.requests[0].headers.get("authorization"), null);
    assert.equal(without.requests[0].headers.get("content-type"), "application/json");

    const withToken = setup(okTickets, "expo-access-test");
    await withToken.push.send([token("a")], message);
    assert.equal(withToken.requests[0].headers.get("authorization"), "Bearer expo-access-test");
  });

  it("los tickets con DeviceNotRegistered devuelven el token como inválido", async () => {
    const { push } = setup(() =>
      json({
        data: [
          { status: "ok", id: "r-1" },
          {
            status: "error",
            message: "no es un destinatario registrado",
            details: { error: DEVICE_NOT_REGISTERED },
          },
          { status: "error", message: "otro error", details: { error: "MessageTooBig" } },
        ],
      }),
    );
    const result = await push.send([token(1), token(2), token(3)], message);
    assert.deepEqual(result, {
      ok: 1,
      failed: 2,
      invalid: [token(2)],
      receipts: [{ id: "r-1", device: token(1) }],
    });
  });

  it("un error de toda la request lanza PushRequestError con los códigos de Expo", async () => {
    for (const [response, status, codes] of [
      [
        json({ errors: [{ code: "TOO_MANY_REQUESTS", message: "x" }] }, 429),
        429,
        ["TOO_MANY_REQUESTS"],
      ],
      [json({ errors: [{ code: "UNAUTHORIZED", message: "x" }] }, 401), 401, ["UNAUTHORIZED"]],
      [new Response("Bad Gateway", { status: 502 }), 502, []],
      // `errors` con 200 también es un fallo de toda la request.
      [
        json({ errors: [{ code: "PUSH_TOO_MANY_EXPERIENCE_IDS", message: "x" }] }),
        200,
        ["PUSH_TOO_MANY_EXPERIENCE_IDS"],
      ],
    ] as const) {
      const { push } = setup(() => response);
      await assert.rejects(
        push.send([token("a")], message),
        (err) =>
          err instanceof PushRequestError &&
          err.status === status &&
          JSON.stringify(err.codes) === JSON.stringify(codes),
      );
    }
  });

  it("si la cantidad de tickets no coincide con los mensajes, lanza", async () => {
    const { push } = setup(() => json({ data: [] }));
    await assert.rejects(push.send([token("a")], message), /tickets/);
  });

  it("corta por timeout", async () => {
    const push = createExpoPush({
      timeoutMs: 50,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    });
    await assert.rejects(push.send([token("a")], message), /timeout|aborted/i);
  });

  it(`consulta los receipts de a ${EXPO_MAX_RECEIPT_IDS} y devuelve los tokens inválidos`, async () => {
    const refs = Array.from({ length: 1500 }, (_, i) => ({ id: `r-${i}`, device: token(i) }));
    const { push, requests } = setup((body) => {
      const data: Record<string, unknown> = {};
      for (const id of (body as { ids: string[] }).ids) {
        // r-7 todavía no tiene receipt; r-3 es DeviceNotRegistered; r-5 otro error.
        if (id === "r-7") continue;
        data[id] =
          id === "r-3"
            ? { status: "error", details: { error: DEVICE_NOT_REGISTERED } }
            : id === "r-5"
              ? { status: "error", details: { error: "MessageRateExceeded" } }
              : { status: "ok" };
      }
      return json({ data });
    });

    const result = await push.checkReceipts(refs);

    assert.deepEqual(
      requests.map((req) => (req.body as { ids: string[] }).ids.length),
      [1000, 500],
    );
    assert.ok(requests.every((req) => req.url === EXPO_RECEIPTS_URL));
    assert.deepEqual(result, { ok: 1497, failed: 2, pending: 1, invalid: [token(3)] });
  });
});

describe("back-service: config de Expo en el worker", () => {
  const env = {
    MONGO_URI: "mongodb://mongo/caloria",
    REDIS_URL: "redis://redis",
    OPENAI_API_KEY: "sk-test",
    ...storageEnv,
  };

  it("EXPO_ACCESS_TOKEN es opcional", () => {
    assert.equal(loadWorkerConfig(env).expo.accessToken, undefined);
    assert.equal(loadWorkerConfig({ ...env, EXPO_ACCESS_TOKEN: "  " }).expo.accessToken, undefined);
  });

  it("con EXPO_ACCESS_TOKEN lo lee sin espacios", () => {
    const config = loadWorkerConfig({ ...env, EXPO_ACCESS_TOKEN: " expo-access-test " });
    assert.equal(config.expo.accessToken, "expo-access-test");
  });
});

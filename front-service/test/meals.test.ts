import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import type { Request, Response } from "express";
import multer from "multer";
import request from "supertest";
import { errorHandler, requestContext } from "@caloria/shared";
import { createApp } from "../src/app";
import { createBackendClient } from "../src/clients/backend";
import { apiRouter } from "../src/routes";
import { captureLogger, listen, UUID } from "./helpers";

type Envelope = { error: { code: string; requestId: string } };

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const USER_ID = "66f1a0000000000000000001";
const MEAL_ID = "66f1a0000000000000000099";
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function makeToken(claims: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: USER_ID, plan: "free", iat: now, exp: now + 900, ...claims };
  const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(payload)}`;
  return `${unsigned}.${sign("sha256", Buffer.from(unsigned), keys.privateKey).toString("base64url")}`;
}
const token = makeToken();

function ftyp(major: string, ...compatible: string[]): Buffer {
  const body = Buffer.from(major + "\0\0\0\0" + compatible.join(""), "latin1");
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length);
  header.write("ftyp", 4, "latin1");
  return Buffer.concat([header, body, Buffer.alloc(256)]);
}
const jpeg = (size = 1024) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4, 1)]);
const heic = ftyp("heic", "mif1", "heic");
const m4a = (size = 512) => Buffer.concat([ftyp("M4A ", "M4A ", "mp42"), Buffer.alloc(size)]);

interface ReceivedFile {
  contentType: string;
  originalname: string;
  buffer: Buffer;
}

interface Received {
  authorization?: string;
  requestId?: string;
  contentType?: string;
  files: Record<string, ReceivedFile>;
  fields: Record<string, unknown>;
}

type Handler = (req: Request, res: Response) => void;
const accepted: Handler = (_req, res) =>
  void res.status(202).json({ mealId: MEAL_ID, status: "processing" });

/** Imita al Backend: parsea el multipart que reenvía el Front y responde 202. */
function fakeBackend() {
  const { logger } = captureLogger("back");
  const received: Received[] = [];
  let handler = accepted;
  const app = express();
  app.use(requestContext({ logger, trustIncomingId: true }));
  app.post("/api/v1/meals", multer({ storage: multer.memoryStorage() }).any(), (req, res) => {
    const files = Object.fromEntries(
      ((req.files ?? []) as Express.Multer.File[]).map((f) => [
        f.fieldname,
        { contentType: f.mimetype, originalname: f.originalname, buffer: f.buffer },
      ]),
    );
    received.push({
      authorization: req.get("authorization"),
      requestId: req.get("x-request-id"),
      contentType: req.get("content-type"),
      files,
      fields: { ...req.body },
    });
    handler(req, res);
  });
  app.use(errorHandler({ logger }));
  return {
    app,
    received,
    respondWith(next: Handler) {
      handler = next;
    },
    reset() {
      received.length = 0;
      handler = accepted;
    },
  };
}

describe("front-service: POST /meals", () => {
  const back = fakeBackend();
  let closeBack: () => Promise<void>;
  let front: express.Express;

  before(async () => {
    const { url, close } = await listen(back.app);
    closeBack = close;
    const client = createBackendClient({ baseUrl: url, timeoutMs: 2000 });
    front = createApp({
      logger: captureLogger("front").logger,
      api: apiRouter(client, keys.publicKey),
    });
  });
  after(async () => {
    await closeBack();
  });
  beforeEach(() => back.reset());

  const post = (auth: string | null = `Bearer ${token}`) => {
    const req = request(front).post("/api/v1/meals");
    return auth === null ? req : req.set("authorization", auth);
  };

  function expectEnvelope(res: request.Response, status: number, code: string) {
    assert.equal(res.status, status, JSON.stringify(res.body));
    const { error } = res.body as Envelope;
    assert.equal(error.code, code);
    assert.equal(error.requestId, res.headers["x-request-id"]);
    assert.match(error.requestId, UUID);
  }
  const assertNotForwarded = () => assert.equal(back.received.length, 0, "llegó al Backend");

  it("foto sola → reenvía al Backend y devuelve su 202", async () => {
    const res = await post().attach("photo", jpeg(), {
      filename: "plato.jpg",
      contentType: "image/jpeg",
    });
    assert.equal(res.status, 202);
    assert.deepEqual(res.body, { mealId: MEAL_ID, status: "processing" });

    assert.equal(back.received.length, 1);
    const [sent] = back.received;
    assert.equal(sent.authorization, `Bearer ${token}`);
    assert.equal(sent.requestId, res.headers["x-request-id"]);
    assert.match(sent.contentType ?? "", /^multipart\/form-data; boundary=/);
    assert.deepEqual(Object.keys(sent.files), ["photo"]);
    assert.equal(sent.files.photo.contentType, "image/jpeg");
    assert.deepEqual(sent.files.photo.buffer, jpeg());
    assert.deepEqual(sent.fields, {});
  });

  it("con audio y nota → reenvía los tres, con el tipo detectado y sin el nombre original", async () => {
    const res = await post()
      .attach("photo", heic, { filename: "IMG_0001.jpg", contentType: "image/jpeg" })
      .attach("audio", m4a(), { filename: "nota.m4a", contentType: "audio/x-m4a" })
      .field("note", " milanesa con puré ");
    assert.equal(res.status, 202);

    const [sent] = back.received;
    assert.equal(sent.files.photo.contentType, "image/heic");
    assert.equal(sent.files.photo.originalname, "photo");
    assert.equal(sent.files.audio.contentType, "audio/mp4");
    assert.deepEqual(sent.files.audio.buffer, m4a());
    assert.deepEqual(sent.fields, { note: "milanesa con puré" });
  });

  it("sin token → 401 UNAUTHORIZED sin leer el body", async () => {
    expectEnvelope(await post(null).attach("photo", jpeg(), "plato.jpg"), 401, "UNAUTHORIZED");
    assertNotForwarded();
  });

  it("con token vencido → 401 TOKEN_EXPIRED", async () => {
    const expired = makeToken({ exp: Math.floor(Date.now() / 1000) - 60 });
    expectEnvelope(
      await post(`Bearer ${expired}`).attach("photo", jpeg(), "plato.jpg"),
      401,
      "TOKEN_EXPIRED",
    );
    assertNotForwarded();
  });

  it("sin foto → 400 VALIDATION_ERROR", async () => {
    expectEnvelope(await post().field("note", "algo"), 400, "VALIDATION_ERROR");
    assertNotForwarded();
  });

  it("sin multipart → 400 VALIDATION_ERROR", async () => {
    expectEnvelope(await post().send({ photo: "x" }), 400, "VALIDATION_ERROR");
    assertNotForwarded();
  });

  it("foto de más de 8 MB → 413 PAYLOAD_TOO_LARGE", async () => {
    const res = await post().attach("photo", jpeg(8 * 1024 * 1024 + 1), "plato.jpg");
    expectEnvelope(res, 413, "PAYLOAD_TOO_LARGE");
    assertNotForwarded();
  });

  it("un archivo que no es imagen renombrado a .jpg → 400 VALIDATION_ERROR", async () => {
    const text = Buffer.from("no soy una foto\n".repeat(50));
    const res = await post().attach("photo", text, {
      filename: "plato.jpg",
      contentType: "image/jpeg",
    });
    expectEnvelope(res, 400, "VALIDATION_ERROR");
    assertNotForwarded();
  });

  it("audio que no es M4A → 400 VALIDATION_ERROR", async () => {
    const res = await post()
      .attach("photo", jpeg(), "plato.jpg")
      .attach("audio", jpeg(), { filename: "nota.m4a", contentType: "audio/mp4" });
    expectEnvelope(res, 400, "VALIDATION_ERROR");
    assertNotForwarded();
  });

  it("audio de más de 4 MB → 413 PAYLOAD_TOO_LARGE", async () => {
    const res = await post()
      .attach("photo", jpeg(), "plato.jpg")
      .attach("audio", m4a(4 * 1024 * 1024), "nota.m4a");
    expectEnvelope(res, 413, "PAYLOAD_TOO_LARGE");
    assertNotForwarded();
  });

  it("nota de más de 500 caracteres → 400 VALIDATION_ERROR", async () => {
    const res = await post().attach("photo", jpeg(), "plato.jpg").field("note", "a".repeat(501));
    expectEnvelope(res, 400, "VALIDATION_ERROR");
    assertNotForwarded();
  });

  it("un campo desconocido → 400 VALIDATION_ERROR", async () => {
    const res = await post().attach("photo", jpeg(), "plato.jpg").field("userId", USER_ID);
    expectEnvelope(res, 400, "VALIDATION_ERROR");
    assertNotForwarded();
  });

  it("un archivo en un campo desconocido o dos fotos → 400 VALIDATION_ERROR", async () => {
    const extraFile = await post()
      .attach("photo", jpeg(), "a.jpg")
      .attach("video", jpeg(), "b.jpg");
    expectEnvelope(extraFile, 400, "VALIDATION_ERROR");
    const twoPhotos = await post()
      .attach("photo", jpeg(), "a.jpg")
      .attach("photo", jpeg(), "b.jpg");
    expectEnvelope(twoPhotos, 400, "VALIDATION_ERROR");
    assertNotForwarded();
  });

  it("query string desconocida → 400 VALIDATION_ERROR", async () => {
    const res = await request(front)
      .post("/api/v1/meals?userId=x")
      .set("authorization", `Bearer ${token}`)
      .attach("photo", jpeg(), "plato.jpg");
    expectEnvelope(res, 400, "VALIDATION_ERROR");
    assertNotForwarded();
  });

  it("un error del Backend llega sin modificar", async () => {
    back.respondWith((req, res) => {
      res.status(503).json({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Servicio no disponible",
          requestId: req.requestId,
        },
      });
    });
    const res = await post().attach("photo", jpeg(), "plato.jpg");
    expectEnvelope(res, 503, "SERVICE_UNAVAILABLE");
  });

  it("Backend caído → 503 SERVICE_UNAVAILABLE", async () => {
    const client = createBackendClient({ baseUrl: "http://127.0.0.1:1", timeoutMs: 500 });
    const app = createApp({
      logger: captureLogger("front").logger,
      api: apiRouter(client, keys.publicKey),
    });
    const res = await request(app)
      .post("/api/v1/meals")
      .set("authorization", `Bearer ${token}`)
      .attach("photo", jpeg(), "plato.jpg");
    expectEnvelope(res, 503, "SERVICE_UNAVAILABLE");
  });
});

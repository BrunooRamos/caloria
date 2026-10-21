import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadStorageConfig } from "../src/config/storage";
import { createMediaService, MAX_SIGNED_URL_TTL_SECONDS } from "../src/services/media";
import { storageEnv } from "./helpers";

const media = createMediaService(loadStorageConfig(storageEnv));
const KEY = "users/66f1a0000000000000000001/meals/plato.jpg";

describe("back-service: media", () => {
  it("firma con el endpoint público, no con el interno", async () => {
    const url = new URL(await media.signedUrl(KEY));
    assert.equal(url.origin, storageEnv.S3_PUBLIC_ENDPOINT);
    assert.equal(url.pathname, `/${storageEnv.S3_BUCKET}/${KEY}`);
    assert.ok(url.searchParams.get("X-Amz-Signature"));
  });

  it("la URL vence a los 15 minutos por defecto", async () => {
    const url = new URL(await media.signedUrl(KEY));
    assert.equal(MAX_SIGNED_URL_TTL_SECONDS, 900);
    assert.equal(url.searchParams.get("X-Amz-Expires"), "900");
  });

  it("nunca firma por más de 15 minutos", async () => {
    const url = new URL(await media.signedUrl(KEY, 24 * 60 * 60));
    assert.equal(url.searchParams.get("X-Amz-Expires"), "900");
  });

  it("acepta un TTL menor", async () => {
    const url = new URL(await media.signedUrl(KEY, 60));
    assert.equal(url.searchParams.get("X-Amz-Expires"), "60");
  });

  it("rechaza tipos de archivo no permitidos sin tocar el bucket", async () => {
    const upload = (kind: "photo" | "audio", contentType: string) =>
      media.upload({ userId: "u1", kind, body: new Uint8Array([1]), contentType });
    await assert.rejects(upload("photo", "image/gif"), { code: "VALIDATION_ERROR" });
    await assert.rejects(upload("photo", "audio/mp4"), { code: "VALIDATION_ERROR" });
    await assert.rejects(upload("audio", "image/jpeg"), { code: "VALIDATION_ERROR" });
    await assert.rejects(upload("photo", "constructor"), { code: "VALIDATION_ERROR" });
  });

  for (const name of Object.keys(storageEnv)) {
    it(`no arranca sin ${name}`, () => {
      assert.throws(() => loadStorageConfig({ ...storageEnv, [name]: " " }), new RegExp(name));
    });
  }
});

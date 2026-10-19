import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import { FORBIDDEN_ENV, loadConfig } from "../src/config";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const valid = { JWT_PUBLIC_KEY: publicPem, BACKEND_URL: "http://back:4000" };

describe("front-service: configuración", () => {
  it("lee la clave pública y aplica los defaults de puerto y timeout", () => {
    const config = loadConfig(valid);
    assert.equal(config.jwtPublicKey.type, "public");
    assert.equal(config.backendUrl, "http://back:4000");
    assert.equal(config.port, 3000);
    assert.equal(config.backendTimeoutMs, 10_000);
  });

  it("acepta la clave con saltos de línea escapados y valores explícitos", () => {
    const config = loadConfig({
      ...valid,
      JWT_PUBLIC_KEY: publicPem.replace(/\n/g, "\\n"),
      BACKEND_URL: "https://back.interna:4000",
      PORT: "8081",
      BACKEND_TIMEOUT_MS: "2500",
    });
    assert.equal(config.port, 8081);
    assert.equal(config.backendTimeoutMs, 2500);
  });

  it("una variable vacía (`PORT=` en el .env) cuenta como ausente", () => {
    assert.equal(loadConfig({ ...valid, PORT: "", BACKEND_TIMEOUT_MS: " " }).port, 3000);
  });

  it("no arranca sin JWT_PUBLIC_KEY ni sin BACKEND_URL", () => {
    assert.throws(() => loadConfig({ BACKEND_URL: valid.BACKEND_URL }), /JWT_PUBLIC_KEY/);
    assert.throws(
      () => loadConfig({ JWT_PUBLIC_KEY: publicPem }),
      /Falta la variable de entorno BACKEND_URL/,
    );
  });

  it("no acepta la clave privada en lugar de la pública", () => {
    assert.throws(() => loadConfig({ ...valid, JWT_PUBLIC_KEY: privatePem }), /clave privada/);
  });

  for (const [name, value] of [
    ["BACKEND_URL", "no es una url"],
    ["BACKEND_URL", "ftp://back:4000"],
    ["PORT", "abc"],
    ["PORT", "70000"],
    ["BACKEND_TIMEOUT_MS", "0"],
    ["BACKEND_TIMEOUT_MS", "600000"],
  ]) {
    it(`${name}=${value} → no arranca`, () => {
      assert.throws(() => loadConfig({ ...valid, [name]: value }), new RegExp(name));
    });
  }

  for (const name of FORBIDDEN_ENV) {
    it(`con ${name} en el entorno → no arranca, y el error no muestra el valor`, () => {
      const secret = "mongodb://admin:s3cr3t@db";
      assert.throws(
        () => loadConfig({ ...valid, [name]: secret }),
        (err: Error) => err.message.includes(name) && !err.message.includes("s3cr3t"),
      );
    });
  }

  it("los errores nombran la variable pero nunca muestran su valor", () => {
    assert.throws(
      () => loadConfig({ ...valid, BACKEND_URL: "http//s3cr3t", PORT: "s3cr3t" }),
      (err: Error) =>
        /BACKEND_URL/.test(err.message) &&
        /PORT/.test(err.message) &&
        !err.message.includes("s3cr3t"),
    );
  });
});

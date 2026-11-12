import assert from "node:assert/strict";
import { request } from "node:https";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadMtlsCredentials, MTLS_BACK_CN, MTLS_FRONT_CN } from "@caloria/shared";
import { createApp } from "../src/app";
import { createMtlsServer } from "../src/server";
import { captureLogger } from "./helpers";
import { generateCerts } from "./mtls-helpers";

const ours = generateCerts();
// Una CA ajena que emite certificados con los mismos nombres: una credencial falsa del Front.
const fake = generateCerts();

type Outcome = { status: number } | { error: string };

function get(port: number, client: { cert?: Buffer; key?: Buffer }): Promise<Outcome> {
  return new Promise((resolve) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: "/health",
        ca: ours.front.ca,
        servername: "localhost",
        ...client,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on("error", (err: NodeJS.ErrnoException) => resolve({ error: err.code ?? err.message }));
    req.end();
  });
}

describe("back-service: mTLS con el Front (RNF-03)", () => {
  const { logger, lines } = captureLogger("back");
  const server = createMtlsServer(
    createApp({ logger }),
    loadMtlsCredentials(MTLS_BACK_CN, ours.back.env),
    logger,
  );
  let port: number;
  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("con el certificado del Front responde", async () => {
    assert.deepEqual(await get(port, { cert: ours.front.cert, key: ours.front.key }), {
      status: 200,
    });
  });

  it("sin certificado de cliente rechaza la conexión", async () => {
    const outcome = await get(port, {});
    assert.ok("error" in outcome, `respondió ${JSON.stringify(outcome)}`);
  });

  it("con un certificado del Front firmado por otra CA rechaza la conexión", async () => {
    const outcome = await get(port, { cert: fake.front.cert, key: fake.front.key });
    assert.ok("error" in outcome, `respondió ${JSON.stringify(outcome)}`);
  });

  it("con el certificado del Backend (misma CA, no es de cliente) rechaza la conexión", async () => {
    const outcome = await get(port, { cert: ours.back.cert, key: ours.back.key });
    assert.ok("error" in outcome, `respondió ${JSON.stringify(outcome)}`);
  });

  it("por HTTP plano no responde", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`).catch((err: Error) => err);
    assert.ok(res instanceof Error || res.status >= 400);
  });

  it("deja en el log los rechazos", () => {
    assert.ok(lines.some((line) => String(line.msg).startsWith("mTLS:")));
  });
});

describe("back-service: credenciales del mTLS al arrancar", () => {
  it("lee CA, certificado y clave del Backend", () => {
    const creds = loadMtlsCredentials(MTLS_BACK_CN, ours.back.env);
    assert.equal(creds.commonName, MTLS_BACK_CN);
  });

  it("no arranca sin las variables", () => {
    assert.throws(() => loadMtlsCredentials(MTLS_BACK_CN, {}), /MTLS_CA_FILE/);
    assert.throws(
      () => loadMtlsCredentials(MTLS_BACK_CN, { ...ours.back.env, MTLS_KEY_FILE: "" }),
      /MTLS_KEY_FILE/,
    );
  });

  it("no arranca con un archivo que no existe", () => {
    assert.throws(
      () =>
        loadMtlsCredentials(MTLS_BACK_CN, { ...ours.back.env, MTLS_CERT_FILE: "/no/existe.pem" }),
      /MTLS_CERT_FILE: no se pudo leer/,
    );
  });

  it("no arranca con el certificado del Front", () => {
    assert.throws(() => loadMtlsCredentials(MTLS_BACK_CN, ours.front.env), /caloria-back/);
    assert.equal(loadMtlsCredentials(MTLS_FRONT_CN, ours.front.env).commonName, MTLS_FRONT_CN);
  });

  it("no arranca si la clave no es la del certificado", () => {
    assert.throws(
      () =>
        loadMtlsCredentials(MTLS_BACK_CN, {
          ...ours.back.env,
          MTLS_KEY_FILE: ours.front.env.MTLS_KEY_FILE,
        }),
      /no es la clave/,
    );
  });

  it("no arranca si el certificado no lo firmó la CA", () => {
    assert.throws(
      () =>
        loadMtlsCredentials(MTLS_BACK_CN, {
          ...ours.back.env,
          MTLS_CA_FILE: fake.back.env.MTLS_CA_FILE,
        }),
      /no está firmado por la CA/,
    );
  });

  it("los errores no muestran el contenido de los archivos", () => {
    const garbage = join(ours.back.dir, "basura.pem");
    writeFileSync(garbage, "s3cr3t");
    assert.throws(
      () => loadMtlsCredentials(MTLS_BACK_CN, { ...ours.back.env, MTLS_KEY_FILE: garbage }),
      (err: Error) => /MTLS_KEY_FILE/.test(err.message) && !err.message.includes("s3cr3t"),
    );
  });
});

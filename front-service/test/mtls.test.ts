import assert from "node:assert/strict";
import { createServer } from "node:https";
import type { Server } from "node:https";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import { after, before, describe, it } from "node:test";
import { Agent } from "undici";
import type { AppError } from "@caloria/shared";
import { createBackendClient } from "../src/clients/backend";
import { generateCerts } from "./mtls-helpers";
import type { PemSet } from "./mtls-helpers";

const ours = generateCerts();
const fake = generateCerts();

/** Un Backend que exige certificado de cliente de nuestra CA y devuelve el CN que vio. */
async function backend(server: PemSet): Promise<{ server: Server; url: string }> {
  const https = createServer(
    { ca: ours.back.ca, cert: server.cert, key: server.key, requestCert: true },
    (req, res) => {
      const cn = (req.socket as TLSSocket).getPeerCertificate().subject?.CN;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ cn }));
    },
  );
  await new Promise<void>((resolve) => https.listen(0, "127.0.0.1", resolve));
  const { port } = https.address() as AddressInfo;
  return { server: https, url: `https://localhost:${port}` };
}

function client(baseUrl: string, creds: PemSet = ours.front) {
  const { ca, cert, key } = creds;
  return createBackendClient({
    baseUrl,
    timeoutMs: 2000,
    dispatcher: new Agent({ connect: { ca, cert, key } }),
  });
}

describe("front-service: cliente del Backend con mTLS", () => {
  let real: Awaited<ReturnType<typeof backend>>;
  let impostor: Awaited<ReturnType<typeof backend>>;
  before(async () => {
    real = await backend(ours.back);
    // Un servidor con un certificado de "back" emitido por otra CA.
    impostor = await backend(fake.back);
  });
  after(() => {
    real.server.close();
    impostor.server.close();
  });

  it("presenta el certificado del Front y el Backend lo ve", async () => {
    const res = await client(real.url).request({ method: "GET", path: "/", requestId: "r1" });
    assert.deepEqual(res.body, { cn: "caloria-front" });
  });

  it("no le habla a un Backend con un certificado de otra CA → 503", async () => {
    await assert.rejects(
      client(impostor.url).request({ method: "GET", path: "/", requestId: "r2" }),
      (err: AppError) => err.code === "SERVICE_UNAVAILABLE",
    );
  });
});

import type { AddressInfo } from "node:net";
import type { Express } from "express";
import { createLogger } from "@caloria/shared";

export async function listen(app: Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export function captureLogger(service: string) {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({ service, write: (line) => lines.push(JSON.parse(line)) });
  return { logger, lines };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Config de storage de prueba: firmar URLs no hace llamadas de red, así que no hace falta MinIO.
export const storageEnv = {
  S3_ENDPOINT: "http://minio:9000",
  S3_PUBLIC_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "caloria-media",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key",
};

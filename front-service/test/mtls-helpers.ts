import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(__dirname, "../../scripts/generate-mtls-certs.sh");

export interface PemSet {
  dir: string;
  ca: Buffer;
  cert: Buffer;
  key: Buffer;
  env: { MTLS_CA_FILE: string; MTLS_CERT_FILE: string; MTLS_KEY_FILE: string };
}

/** Corre el script del repo en una carpeta temporal: CA propia + certificados de Front y Backend. */
export function generateCerts() {
  const dir = mkdtempSync(join(tmpdir(), "caloria-mtls-"));
  execFileSync("bash", [SCRIPT, dir], { stdio: "ignore" });
  const set = (name: "back" | "front"): PemSet => {
    const files = {
      MTLS_CA_FILE: join(dir, name, "ca.pem"),
      MTLS_CERT_FILE: join(dir, name, "cert.pem"),
      MTLS_KEY_FILE: join(dir, name, "key.pem"),
    };
    return {
      dir,
      ca: readFileSync(files.MTLS_CA_FILE),
      cert: readFileSync(files.MTLS_CERT_FILE),
      key: readFileSync(files.MTLS_KEY_FILE),
      env: files,
    };
  };
  return { back: set("back"), front: set("front") };
}

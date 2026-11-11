import { readFileSync } from "node:fs";
import { createPrivateKey, X509Certificate } from "node:crypto";

/** CN de los certificados que emite scripts/generate-mtls-certs.sh. */
export const MTLS_FRONT_CN = "caloria-front";
export const MTLS_BACK_CN = "caloria-back";

export const MTLS_ENV = ["MTLS_CA_FILE", "MTLS_CERT_FILE", "MTLS_KEY_FILE"] as const;

export interface MtlsCredentials {
  /** CA propia: la única en la que se confía para el otro extremo. */
  ca: Buffer;
  cert: Buffer;
  key: Buffer;
  /** CN del certificado propio. */
  commonName: string;
}

const HINT = "(npm run certs:generate en la raíz)";

function readFile(env: NodeJS.ProcessEnv, name: (typeof MTLS_ENV)[number]): Buffer {
  const path = env[name]?.trim();
  if (!path) throw new Error(`Falta la variable de entorno ${name} ${HINT}`);
  try {
    return readFileSync(path);
  } catch {
    throw new Error(`${name}: no se pudo leer el archivo ${HINT}`);
  }
}

function parse<T>(message: string, fn: () => T): T {
  try {
    return fn();
  } catch {
    throw new Error(message);
  }
}

/**
 * Lee la CA, el certificado y la clave del mTLS de los archivos de MTLS_CA_FILE, MTLS_CERT_FILE y
 * MTLS_KEY_FILE. Lanza si falta alguno, si la clave no es la del certificado, si el certificado no
 * lo firmó la CA o si su CN no es `expectedCn`: el servicio no arranca. Los errores nombran la
 * variable, nunca el contenido.
 */
export function loadMtlsCredentials(
  expectedCn: string,
  env: NodeJS.ProcessEnv = process.env,
): MtlsCredentials {
  const ca = readFile(env, "MTLS_CA_FILE");
  const cert = readFile(env, "MTLS_CERT_FILE");
  const key = readFile(env, "MTLS_KEY_FILE");

  const caCert = parse(
    "MTLS_CA_FILE no es un certificado PEM válido",
    () => new X509Certificate(ca),
  );
  const ownCert = parse(
    "MTLS_CERT_FILE no es un certificado PEM válido",
    () => new X509Certificate(cert),
  );
  const privateKey = parse("MTLS_KEY_FILE no es una clave privada PEM válida", () =>
    createPrivateKey(key),
  );

  if (!caCert.ca) throw new Error("MTLS_CA_FILE no es un certificado de CA");
  if (!ownCert.checkPrivateKey(privateKey)) {
    throw new Error("MTLS_KEY_FILE no es la clave de MTLS_CERT_FILE");
  }
  if (!ownCert.checkIssued(caCert) || !ownCert.verify(caCert.publicKey)) {
    throw new Error("MTLS_CERT_FILE no está firmado por la CA de MTLS_CA_FILE");
  }
  const commonName = commonNameOf(ownCert.subject);
  if (commonName !== expectedCn) {
    throw new Error(`MTLS_CERT_FILE tiene que ser el certificado de ${expectedCn}`);
  }
  if (Date.parse(ownCert.validTo) < Date.now()) {
    throw new Error(`MTLS_CERT_FILE está vencido ${HINT}`);
  }
  return { ca, cert, key, commonName };
}

/** `O=CalorIA\nCN=caloria-front` → `caloria-front`. */
function commonNameOf(subject: string): string | undefined {
  return subject
    .split("\n")
    .find((part) => part.startsWith("CN="))
    ?.slice(3);
}

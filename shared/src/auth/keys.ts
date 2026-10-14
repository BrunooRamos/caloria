import { createPrivateKey, createPublicKey } from "node:crypto";
import type { KeyObject } from "node:crypto";

const MIN_MODULUS_BITS = 2048;

function readPem(env: NodeJS.ProcessEnv, name: string): string {
  const raw = env[name]?.trim();
  if (!raw)
    throw new Error(`Falta la variable de entorno ${name} (ver scripts/generate-jwt-keys.mjs)`);
  return raw.replace(/\\n/g, "\n");
}

function assertRsa(key: KeyObject, name: string): KeyObject {
  const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
  if (key.asymmetricKeyType !== "rsa" || bits < MIN_MODULUS_BITS) {
    throw new Error(`${name} tiene que ser una clave RSA de al menos ${MIN_MODULUS_BITS} bits`);
  }
  return key;
}

function parse<T>(name: string, fn: () => T): T {
  try {
    return fn();
  } catch {
    throw new Error(`${name} no es una clave PEM válida`);
  }
}

export function loadPrivateKey(name: string, env = process.env): KeyObject {
  const pem = readPem(env, name);
  return assertRsa(
    parse(name, () => createPrivateKey(pem)),
    name,
  );
}

export function loadPublicKey(name: string, env = process.env): KeyObject {
  const pem = readPem(env, name);
  if (pem.includes("PRIVATE KEY")) {
    throw new Error(`${name} contiene una clave privada; acá va solo la pública`);
  }
  const key = parse(name, () => createPublicKey(pem));
  if (key.type !== "public") throw new Error(`${name} tiene que ser una clave pública`);
  return assertRsa(key, name);
}

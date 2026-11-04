import { createPublicKey } from "node:crypto";
import { loadPrivateKey } from "@caloria/shared";
import { loadStorageConfig } from "./storage";

/** Lee la configuración del entorno. Lanza si falta algo obligatorio: el servicio no arranca. */
export function loadConfig(env = process.env) {
  const mongoUri = env.MONGO_URI?.trim();
  if (!mongoUri) throw new Error("Falta la variable de entorno MONGO_URI");
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) throw new Error("Falta la variable de entorno REDIS_URL");
  const jwtPrivateKey = loadPrivateKey("JWT_PRIVATE_KEY", env);
  return {
    port: Number(env.PORT) || 4000,
    mongoUri,
    redisUrl,
    jwtPrivateKey,
    jwtPublicKey: createPublicKey(jwtPrivateKey),
    storage: loadStorageConfig(env),
    freeMonthlyAnalyses: parseFreeMonthlyAnalyses(env.FREE_MONTHLY_ANALYSES),
  };
}

function parseFreeMonthlyAnalyses(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) throw new Error("Falta la variable de entorno FREE_MONTHLY_ANALYSES");
  const limit = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(limit)) {
    throw new Error(`FREE_MONTHLY_ANALYSES tiene que ser un entero ≥ 0 (vino "${value}")`);
  }
  return limit;
}

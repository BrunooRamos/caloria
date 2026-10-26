import { loadStorageConfig } from "./storage";

export const DEFAULT_WORKER_CONCURRENCY = 2;

/**
 * Config del Worker. Aparte de `loadConfig` para que la clave privada de JWT no le llegue.
 * Lanza si falta algo obligatorio: el worker no arranca.
 */
export function loadWorkerConfig(env = process.env) {
  const mongoUri = env.MONGO_URI?.trim();
  if (!mongoUri) throw new Error("Falta la variable de entorno MONGO_URI");
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) throw new Error("Falta la variable de entorno REDIS_URL");
  return {
    mongoUri,
    redisUrl,
    concurrency: parseConcurrency(env.WORKER_CONCURRENCY),
    storage: loadStorageConfig(env),
  };
}

function parseConcurrency(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_WORKER_CONCURRENCY;
  const concurrency = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error(`WORKER_CONCURRENCY tiene que ser un entero positivo (vino "${value}")`);
  }
  return concurrency;
}

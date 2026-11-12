import { createPublicKey } from "node:crypto";
import { loadMtlsCredentials, loadPrivateKey, MTLS_BACK_CN } from "@caloria/shared";
import { DEFAULT_DAILY_ANALYSES } from "../services/quota";
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
    dailyAnalyses: {
      free: parsePositiveInt("DAILY_ANALYSES_FREE", env, DEFAULT_DAILY_ANALYSES.free),
      premium: parsePositiveInt("DAILY_ANALYSES_PREMIUM", env, DEFAULT_DAILY_ANALYSES.premium),
    },
    billing: loadBillingConfig(env),
    // mTLS con el Front (RNF-03): sin certificados válidos, el Backend no arranca.
    mtls: loadMtlsCredentials(MTLS_BACK_CN, env),
  };
}

const BILLING_VARS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ID",
  "BILLING_SUCCESS_URL",
  "BILLING_CANCEL_URL",
] as const;

export function loadBillingConfig(env: NodeJS.ProcessEnv) {
  const values = Object.fromEntries(BILLING_VARS.map((name) => [name, env[name]?.trim() ?? ""]));
  const missing = BILLING_VARS.filter((name) => !values[name]);
  if (missing.length === BILLING_VARS.length) return undefined;
  if (missing.length > 0) {
    throw new Error(`Billing configurado a medias: faltan ${missing.join(", ")}`);
  }
  if (!/^(sk|rk)_test_/.test(values.STRIPE_SECRET_KEY)) {
    throw new Error("STRIPE_SECRET_KEY tiene que ser una clave de test (sk_test_… o rk_test_…)");
  }
  if (!values.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")) {
    throw new Error("STRIPE_WEBHOOK_SECRET tiene que empezar con whsec_");
  }
  for (const name of ["BILLING_SUCCESS_URL", "BILLING_CANCEL_URL"] as const) {
    if (!URL.canParse(values[name]) || !/^https?:$/.test(new URL(values[name]).protocol)) {
      throw new Error(`${name} tiene que ser una URL http(s)`);
    }
  }
  return {
    secretKey: values.STRIPE_SECRET_KEY,
    webhookSecret: values.STRIPE_WEBHOOK_SECRET,
    priceId: values.STRIPE_PRICE_ID,
    successUrl: values.BILLING_SUCCESS_URL,
    cancelUrl: values.BILLING_CANCEL_URL,
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

/** Entero ≥ 1 opcional: sin la variable, vale `fallback`. */
function parsePositiveInt(name: string, env: NodeJS.ProcessEnv, fallback: number): number {
  const value = env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} tiene que ser un entero ≥ 1 (vino "${value}")`);
  }
  return parsed;
}

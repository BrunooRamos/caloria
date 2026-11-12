import { z } from "zod";
import { loadMtlsCredentials, loadPublicKey, MTLS_FRONT_CN } from "@caloria/shared";

export const FORBIDDEN_ENV = [
  "JWT_PRIVATE_KEY",
  "MONGO_URI",
  "REDIS_URL",
  "OPENAI_API_KEY",
] as const;

const missing = (name: string) => ({
  error: (issue: { input?: unknown }) =>
    issue.input === undefined ? `Falta la variable de entorno ${name}` : undefined,
});

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  // Siempre HTTPS: la conexión al Backend va con mTLS (RNF-03).
  BACKEND_URL: z.url({
    protocol: /^https$/,
    error: (issue) =>
      issue.input === undefined
        ? "Falta la variable de entorno BACKEND_URL"
        : "tiene que ser una URL https:// (el Backend solo atiende con mTLS)",
  }),
  BACKEND_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
  JWT_PUBLIC_KEY: z.string(missing("JWT_PUBLIC_KEY")).transform((pem, ctx) => {
    try {
      return loadPublicKey("JWT_PUBLIC_KEY", { JWT_PUBLIC_KEY: pem });
    } catch (err) {
      ctx.addIssue({ code: "custom", message: (err as Error).message });
      return z.NEVER;
    }
  }),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const forbidden = FORBIDDEN_ENV.filter((name) => env[name]?.trim());
  if (forbidden.length > 0) {
    throw new Error(`front-service no debe recibir ${forbidden.join(", ")}`);
  }

  const pick = (name: keyof z.input<typeof envSchema>) => env[name]?.trim() || undefined;
  const result = envSchema.safeParse({
    PORT: pick("PORT"),
    BACKEND_URL: pick("BACKEND_URL"),
    BACKEND_TIMEOUT_MS: pick("BACKEND_TIMEOUT_MS"),
    JWT_PUBLIC_KEY: pick("JWT_PUBLIC_KEY"),
  });
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Configuración inválida. ${issues.join("; ")}`);
  }

  const { data } = result;
  // Certificado de cliente del Front y la CA propia con la que verifica al Backend.
  const mtls = loadMtlsCredentials(MTLS_FRONT_CN, env);
  return {
    port: data.PORT,
    backendUrl: data.BACKEND_URL,
    backendTimeoutMs: data.BACKEND_TIMEOUT_MS,
    jwtPublicKey: data.JWT_PUBLIC_KEY,
    mtls,
  };
}

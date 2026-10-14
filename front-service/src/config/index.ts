import { loadPublicKey } from "@caloria/shared";

/** Lee la configuración del entorno. Lanza si falta algo obligatorio: el servicio no arranca. */
export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 3000,
    backendUrl: env.BACKEND_URL ?? "http://localhost:4000",
    backendTimeoutMs: Number(env.BACKEND_TIMEOUT_MS) || 10_000,
    jwtPublicKey: loadPublicKey("JWT_PUBLIC_KEY", env),
  };
}

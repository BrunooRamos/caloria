import { createPublicKey } from "node:crypto";
import { loadPrivateKey } from "@caloria/shared";

/** Lee la configuración del entorno. Lanza si falta algo obligatorio: el servicio no arranca. */
export function loadConfig(env = process.env) {
  const mongoUri = env.MONGO_URI?.trim();
  if (!mongoUri) throw new Error("Falta la variable de entorno MONGO_URI");
  const jwtPrivateKey = loadPrivateKey("JWT_PRIVATE_KEY", env);
  return {
    port: Number(env.PORT) || 4000,
    mongoUri,
    jwtPrivateKey,
    jwtPublicKey: createPublicKey(jwtPrivateKey),
  };
}

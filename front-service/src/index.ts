import { Agent } from "undici";
import { createLogger, serializeError } from "@caloria/shared";
import { createApp } from "./app";
import { createBackendClient } from "./clients/backend";
import { loadConfig } from "./config";
import { apiRouter } from "./routes";

const logger = createLogger({ service: "front" });

try {
  const config = loadConfig();
  const { ca, cert, key } = config.mtls;
  const backend = createBackendClient({
    baseUrl: config.backendUrl,
    timeoutMs: config.backendTimeoutMs,
    // mTLS (RNF-03): presenta el certificado del Front y solo confía en el Backend de nuestra CA.
    dispatcher: new Agent({ connect: { ca, cert, key, minVersion: "TLSv1.3" } }),
  });
  createApp({ logger, api: apiRouter(backend, config.jwtPublicKey) }).listen(config.port, () => {
    logger.info(`front-service escuchando en :${config.port}`);
  });
} catch (err) {
  logger.error("front-service no pudo arrancar", { err: serializeError(err, { stack: true }) });
  process.exit(1);
}

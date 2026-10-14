import { createLogger, serializeError } from "@caloria/shared";
import { createApp } from "./app";
import { createBackendClient } from "./clients/backend";
import { loadConfig } from "./config";
import { authRouter } from "./routes/auth";

const logger = createLogger({ service: "front" });

try {
  const config = loadConfig();
  const backend = createBackendClient({
    baseUrl: config.backendUrl,
    timeoutMs: config.backendTimeoutMs,
  });
  createApp({ logger, api: authRouter(backend) }).listen(config.port, () => {
    logger.info(`front-service escuchando en :${config.port}`);
  });
} catch (err) {
  logger.error("front-service no pudo arrancar", { err: serializeError(err, { stack: true }) });
  process.exit(1);
}

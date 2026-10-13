import mongoose from "mongoose";
import { createLogger, serializeError } from "@caloria/shared";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { User } from "./models/user";
import { apiRouter } from "./routes";
import { createAuthService } from "./services/auth";

const logger = createLogger({ service: "back" });

async function main() {
  const config = loadConfig();
  await mongoose.connect(config.mongoUri);
  // Asegura el índice único de email antes de aceptar registros.
  await User.init();

  const auth = createAuthService({ privateKey: config.jwtPrivateKey });
  createApp({ logger, api: apiRouter({ auth }) }).listen(config.port, () => {
    logger.info(`back-service escuchando en :${config.port}`);
  });
}

main().catch((err: unknown) => {
  logger.error("back-service no pudo arrancar", { err: serializeError(err, { stack: true }) });
  process.exit(1);
});

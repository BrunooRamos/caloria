import { createLogger } from "@caloria/shared";
import { createApp } from "./app";
import { config } from "./config";

const logger = createLogger({ service: "front" });

createApp({ logger }).listen(config.port, () => {
  logger.info(`front-service escuchando en :${config.port}`);
});

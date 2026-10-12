import { createLogger } from "@caloria/shared";
import { createApp } from "./app";

const logger = createLogger({ service: "back" });
const port = Number(process.env.PORT) || 4000;

createApp({ logger }).listen(port, () => {
  logger.info(`back-service escuchando en :${port}`);
});

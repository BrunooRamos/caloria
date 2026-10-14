import { createLogger } from "@caloria/shared";
import { createApp } from "./app";
import { connectMongo, mongoStatus } from "./config/db";
import { UserModel } from "./models/User";

const logger = createLogger({ service: "back" });
const port = Number(process.env.PORT) || 4000;

createApp({ logger, mongoStatus }).listen(port, () => {
  logger.info(`back-service escuchando en :${port}`);
});

connectMongo()
  .then(() => UserModel.syncIndexes())
  .catch((err) => {
    logger.error("no se pudo inicializar mongo", { err });
    process.exit(1);
  });

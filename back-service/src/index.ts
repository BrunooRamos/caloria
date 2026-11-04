import { createLogger, serializeError } from "@caloria/shared";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { connectMongo, mongoStatus } from "./config/db";
import { createMealAnalysisQueue } from "./jobs/meal-analysis";
import { MealModel } from "./models/Meal";
import { UserModel } from "./models/User";
import { WeeklySummaryModel } from "./models/WeeklySummary";
import { apiRouter } from "./routes";
import { createAuthService } from "./services/auth";
import { createDashboardService } from "./services/dashboard";
import { createMealService } from "./services/meals";
import { createMediaService } from "./services/media";
import { createQuotaService } from "./services/quota";
import { createSummaryService } from "./services/summaries";
import { createUserService } from "./services/users";

const logger = createLogger({ service: "back" });

async function main() {
  const config = loadConfig();
  const auth = createAuthService({ privateKey: config.jwtPrivateKey });
  const meals = createMealService({
    media: createMediaService(config.storage),
    queue: createMealAnalysisQueue({ redisUrl: config.redisUrl, logger }),
    quota: createQuotaService({ freeMonthlyAnalyses: config.freeMonthlyAnalyses }),
  });
  const api = apiRouter({
    auth,
    users: createUserService(),
    meals,
    dashboard: createDashboardService(),
    summaries: createSummaryService(),
    publicKey: config.jwtPublicKey,
  });
  createApp({ logger, api, mongoStatus }).listen(config.port, () => {
    logger.info(`back-service escuchando en :${config.port}`);
  });

  // Mientras Mongo no conecta, /health responde 503 y Mongoose deja los comandos en espera.
  await connectMongo(config.mongoUri);
  await UserModel.syncIndexes();
  await MealModel.syncIndexes();
  await WeeklySummaryModel.syncIndexes();
}

main().catch((err: unknown) => {
  logger.error("back-service no pudo arrancar", { err: serializeError(err, { stack: true }) });
  process.exit(1);
});

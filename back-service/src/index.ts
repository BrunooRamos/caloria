import { createLogger, serializeError } from "@caloria/shared";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { connectMongo, mongoStatus } from "./config/db";
import { createAccountDeletionQueue } from "./jobs/account-deletion";
import { createMealAnalysisQueue } from "./jobs/meal-analysis";
import { AccountDeletionModel } from "./models/AccountDeletion";
import { BillingEventModel } from "./models/BillingEvent";
import { MealModel } from "./models/Meal";
import { UserModel } from "./models/User";
import { WeeklySummaryModel } from "./models/WeeklySummary";
import { apiRouter } from "./routes";
import { createMtlsServer } from "./server";
import { createAccountDeletionService } from "./services/account-deletion";
import { createAuthService } from "./services/auth";
import { createBillingService, createStripeBillingProvider } from "./services/billing";
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
  const quota = createQuotaService({ freeMonthlyAnalyses: config.freeMonthlyAnalyses });
  const meals = createMealService({
    media: createMediaService(config.storage),
    queue: createMealAnalysisQueue({ redisUrl: config.redisUrl, logger }),
    quota,
  });
  if (!config.billing) {
    logger.warn("billing apagado: faltan las claves del proveedor de pagos (ver .env.example)");
  }
  const billing = createBillingService({
    provider: config.billing && createStripeBillingProvider(config.billing),
    quota,
  });
  const deletionQueue = createAccountDeletionQueue({
    redisUrl: config.redisUrl,
    logger,
    failFast: true,
  });
  const accounts = createAccountDeletionService({
    billing,
    enqueuePurge: (userId) => deletionQueue.enqueuePurge(userId),
  });
  const api = apiRouter({
    auth,
    users: createUserService(),
    meals,
    dashboard: createDashboardService(),
    summaries: createSummaryService(),
    billing,
    accounts,
    publicKey: config.jwtPublicKey,
  });
  const app = createApp({ logger, api, mongoStatus });
  createMtlsServer(app, config.mtls, logger).listen(config.port, () => {
    logger.info(`back-service escuchando en :${config.port} (HTTPS con mTLS)`);
  });

  // Mientras Mongo no conecta, /health responde 503 y Mongoose deja los comandos en espera.
  await connectMongo(config.mongoUri);
  await UserModel.syncIndexes();
  await MealModel.syncIndexes();
  await WeeklySummaryModel.syncIndexes();
  await BillingEventModel.syncIndexes();
  await AccountDeletionModel.syncIndexes();
}

main().catch((err: unknown) => {
  logger.error("back-service no pudo arrancar", { err: serializeError(err, { stack: true }) });
  process.exit(1);
});

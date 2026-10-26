import mongoose from "mongoose";
import { createLogger, serializeError } from "@caloria/shared";
import { loadWorkerConfig } from "./config/worker";
import { connectMongo } from "./config/db";
import { MEAL_ANALYSIS_QUEUE } from "./jobs/meal-analysis";
import { createMealAnalysisProcessor } from "./jobs/meal-analysis-processor";
import type { AnalyzeMeal } from "./jobs/meal-analysis-processor";
import { createMealAnalysisWorker } from "./jobs/meal-analysis-worker";
import { createMediaService } from "./services/media";

const logger = createLogger({ service: "worker" });

// Todavía no analiza: la comida queda en processing hasta que llegue la IA (#18).
const analyze: AnalyzeMeal = async () => {};

async function main() {
  const config = loadWorkerConfig();
  await connectMongo(config.mongoUri);

  const worker = createMealAnalysisWorker({
    redisUrl: config.redisUrl,
    concurrency: config.concurrency,
    processor: createMealAnalysisProcessor({ media: createMediaService(config.storage), analyze }),
    logger,
  });

  // Primero el worker (espera los jobs en curso) y después Mongo, que esos jobs todavía usan.
  let closing = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    logger.info("worker cerrando", { signal });
    try {
      await worker.close();
      await mongoose.disconnect();
      logger.info("worker cerrado");
      process.exit(0);
    } catch (err) {
      logger.error("worker no pudo cerrar limpio", { err: serializeError(err, { stack: true }) });
      process.exit(1);
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  await worker.ready();
  logger.info(`worker consumiendo la cola ${MEAL_ANALYSIS_QUEUE}`, {
    concurrency: config.concurrency,
  });
}

main().catch((err: unknown) => {
  logger.error("worker no pudo arrancar", { err: serializeError(err, { stack: true }) });
  process.exit(1);
});

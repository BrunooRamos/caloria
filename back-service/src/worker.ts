import mongoose from "mongoose";
import { createLogger, serializeError } from "@caloria/shared";
import { loadAnalysisPrompt } from "./config/analysis-prompt";
import { loadWorkerConfig } from "./config/worker";
import { connectMongo } from "./config/db";
import { createAnalyzeMeal } from "./jobs/analyze-meal";
import { MEAL_ANALYSIS_QUEUE } from "./jobs/meal-analysis";
import { createMealAnalysisProcessor } from "./jobs/meal-analysis-processor";
import { createMealAnalysisWorker } from "./jobs/meal-analysis-worker";
import { createPushReceiptsQueue, PUSH_RECEIPTS_QUEUE } from "./jobs/push-receipts";
import { createPushReceiptsProcessor, createPushReceiptsWorker } from "./jobs/push-receipts-worker";
import { createMediaService } from "./services/media";
import { createNotificationService } from "./services/notifications";
import { createExpoPush } from "./services/push";
import { createOpenAiTranscription } from "./services/transcription";
import { createOpenAiVision } from "./services/vision";

const logger = createLogger({ service: "worker" });

async function main() {
  const config = loadWorkerConfig();
  // Se lee una sola vez: sin archivo o sin versión, el worker no arranca.
  const prompt = loadAnalysisPrompt();
  await connectMongo(config.mongoUri);

  const vision = createOpenAiVision({
    apiKey: config.openai.apiKey,
    model: config.openai.visionModel,
    prompt,
  });
  const transcriber = createOpenAiTranscription({
    apiKey: config.openai.apiKey,
    model: config.openai.transcriptionModel,
  });
  const push = createExpoPush({ accessToken: config.expo.accessToken });
  const receiptsQueue = createPushReceiptsQueue({ redisUrl: config.redisUrl, logger });
  const receiptsWorker = createPushReceiptsWorker({
    redisUrl: config.redisUrl,
    processor: createPushReceiptsProcessor(push),
    logger,
  });
  // Lo usa también el cron del Wrapped (#36) con notifyWrappedReady.
  const notifications = createNotificationService({ push, receipts: receiptsQueue, logger });
  const worker = createMealAnalysisWorker({
    redisUrl: config.redisUrl,
    concurrency: config.concurrency,
    processor: createMealAnalysisProcessor({
      media: createMediaService(config.storage),
      analyze: createAnalyzeMeal({ vision, transcriber, notifications }),
    }),
    logger,
  });

  // Primero los workers (esperan los jobs en curso), después la cola de receipts, en la que el
  // análisis todavía encola, y al final Mongo, que esos jobs todavía usan.
  let closing = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    logger.info("worker cerrando", { signal });
    try {
      await Promise.all([worker.close(), receiptsWorker.close()]);
      await receiptsQueue.close();
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

  await Promise.all([worker.ready(), receiptsWorker.ready()]);
  logger.info(`worker consumiendo las colas ${MEAL_ANALYSIS_QUEUE} y ${PUSH_RECEIPTS_QUEUE}`, {
    concurrency: config.concurrency,
    model: config.openai.visionModel,
    transcriptionModel: config.openai.transcriptionModel,
    promptVersion: prompt.version,
    expoAuth: Boolean(config.expo.accessToken),
  });
}

main().catch((err: unknown) => {
  logger.error("worker no pudo arrancar", { err: serializeError(err, { stack: true }) });
  process.exit(1);
});

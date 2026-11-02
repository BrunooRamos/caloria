import mongoose from "mongoose";
import { createLogger, serializeError } from "@caloria/shared";
import {
  ANALYSIS_PROMPT_PATH,
  IDENTIFY_PROMPT_PATH,
  loadPrompt,
  WRAPPED_PROMPT_PATH,
} from "./config/prompts";
import { loadWorkerConfig } from "./config/worker";
import { connectMongo } from "./config/db";
import { createAnalyzeMeal } from "./jobs/analyze-meal";
import { MEAL_ANALYSIS_QUEUE } from "./jobs/meal-analysis";
import { createMealAnalysisProcessor } from "./jobs/meal-analysis-processor";
import { createMealAnalysisWorker } from "./jobs/meal-analysis-worker";
import { createPushReceiptsQueue, PUSH_RECEIPTS_QUEUE } from "./jobs/push-receipts";
import { createPushReceiptsProcessor, createPushReceiptsWorker } from "./jobs/push-receipts-worker";
import {
  createWeeklySummaryQueue,
  WEEKLY_SUMMARY_PATTERN,
  WEEKLY_SUMMARY_QUEUE,
  WEEKLY_SUMMARY_TZ,
} from "./jobs/weekly-summary";
import {
  createWeeklyFanOut,
  createWeeklySummaryProcessor,
  markWeeklySummaryFailed,
} from "./jobs/weekly-summary-processor";
import { createWeeklySummaryWorker } from "./jobs/weekly-summary-worker";
import { WeeklySummaryModel } from "./models/WeeklySummary";
import { createOpenAiInsights } from "./services/insights";
import { createOpenAiDishIdentifier } from "./services/dish-identifier";
import { createMediaService } from "./services/media";
import { createNotificationService } from "./services/notifications";
import { createExpoPush } from "./services/push";
import { createMongoSimilarMealsFinder } from "./services/similar-meals";
import { createOpenAiTranscription } from "./services/transcription";
import { createOpenAiVision } from "./services/vision";
import { createWeeklyMetricsService } from "./services/weekly-metrics";

const logger = createLogger({ service: "worker" });

async function main() {
  const config = loadWorkerConfig();
  // Se leen una sola vez: sin archivo o sin versión, el worker no arranca.
  const prompt = loadPrompt(ANALYSIS_PROMPT_PATH, "de análisis");
  const identifyPrompt = loadPrompt(IDENTIFY_PROMPT_PATH, "de identificación");
  const wrappedPrompt = loadPrompt(WRAPPED_PROMPT_PATH, "del Wrapped");
  await connectMongo(config.mongoUri);
  // El índice único { userId, week } es el que evita duplicar un Wrapped.
  await WeeklySummaryModel.syncIndexes();

  const vision = createOpenAiVision({
    apiKey: config.openai.apiKey,
    model: config.openai.visionModel,
    prompt,
  });
  const transcriber = createOpenAiTranscription({
    apiKey: config.openai.apiKey,
    model: config.openai.transcriptionModel,
  });
  const identifier = createOpenAiDishIdentifier({
    apiKey: config.openai.apiKey,
    model: config.openai.visionModel,
    prompt: identifyPrompt,
  });
  const push = createExpoPush({ accessToken: config.expo.accessToken });
  const receiptsQueue = createPushReceiptsQueue({ redisUrl: config.redisUrl, logger });
  const receiptsWorker = createPushReceiptsWorker({
    redisUrl: config.redisUrl,
    processor: createPushReceiptsProcessor(push),
    logger,
  });
  // La usan el análisis (análisis listo) y el Wrapped (Wrapped listo).
  const notifications = createNotificationService({ push, receipts: receiptsQueue, logger });
  const worker = createMealAnalysisWorker({
    redisUrl: config.redisUrl,
    concurrency: config.concurrency,
    processor: createMealAnalysisProcessor({
      media: createMediaService(config.storage),
      analyze: createAnalyzeMeal({
        vision,
        transcriber,
        identifier,
        notifications,
        similarMeals: createMongoSimilarMealsFinder(),
      }),
    }),
    logger,
  });

  const weeklyMetrics = createWeeklyMetricsService();
  const weeklyQueue = createWeeklySummaryQueue({ redisUrl: config.redisUrl, logger });
  const weeklyWorker = createWeeklySummaryWorker({
    redisUrl: config.redisUrl,
    concurrency: config.concurrency,
    fanOut: createWeeklyFanOut({ metrics: weeklyMetrics, queue: weeklyQueue }),
    summary: createWeeklySummaryProcessor({
      metrics: weeklyMetrics,
      insights: createOpenAiInsights({
        apiKey: config.openai.apiKey,
        model: config.openai.textModel,
        prompt: wrappedPrompt,
      }),
      notifications,
    }),
    markFailed: markWeeklySummaryFailed,
    logger,
  });

  // Primero los workers (esperan los jobs en curso), después las colas, en las que esos jobs
  // todavía encolan, y al final Mongo, que también usan.
  let closing = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    logger.info("worker cerrando", { signal });
    try {
      await Promise.all([worker.close(), receiptsWorker.close(), weeklyWorker.close()]);
      await Promise.all([receiptsQueue.close(), weeklyQueue.close()]);
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
    identifyPromptVersion: identifyPrompt.version,
    expoAuth: Boolean(config.expo.accessToken),
  });

  // Idempotente: con el mismo id, reiniciar el worker actualiza el cron y no lo duplica.
  await weeklyQueue.registerScheduler();
  await weeklyWorker.ready();
  logger.info(`worker consumiendo la cola ${WEEKLY_SUMMARY_QUEUE}`, {
    pattern: WEEKLY_SUMMARY_PATTERN,
    tz: WEEKLY_SUMMARY_TZ,
    model: config.openai.textModel,
    promptVersion: wrappedPrompt.version,
  });
}

main().catch((err: unknown) => {
  logger.error("worker no pudo arrancar", { err: serializeError(err, { stack: true }) });
  process.exit(1);
});

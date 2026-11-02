import mongoose from "mongoose";
import { createLogger, serializeError } from "@caloria/shared";
import { ANALYSIS_PROMPT_PATH, IDENTIFY_PROMPT_PATH, loadPrompt } from "./config/prompts";
import { loadWorkerConfig } from "./config/worker";
import { loadWrappedPrompt } from "./config/wrapped-prompt";
import { connectMongo } from "./config/db";
import { createAnalyzeMeal } from "./jobs/analyze-meal";
import { MEAL_ANALYSIS_QUEUE } from "./jobs/meal-analysis";
import { createMealAnalysisProcessor } from "./jobs/meal-analysis-processor";
import { createMealAnalysisWorker } from "./jobs/meal-analysis-worker";
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
  const wrappedPrompt = loadWrappedPrompt();
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
  const worker = createMealAnalysisWorker({
    redisUrl: config.redisUrl,
    concurrency: config.concurrency,
    processor: createMealAnalysisProcessor({
      media: createMediaService(config.storage),
      analyze: createAnalyzeMeal({
        vision,
        transcriber,
        identifier,
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
    }),
    markFailed: markWeeklySummaryFailed,
    logger,
  });

  // Primero los workers (esperan los jobs en curso) y después Mongo, que esos jobs todavía usan.
  let closing = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    logger.info("worker cerrando", { signal });
    try {
      await Promise.all([worker.close(), weeklyWorker.close()]);
      await weeklyQueue.close();
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
    model: config.openai.visionModel,
    transcriptionModel: config.openai.transcriptionModel,
    promptVersion: prompt.version,
    identifyPromptVersion: identifyPrompt.version,
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

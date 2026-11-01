import mongoose from "mongoose";
import { createLogger, serializeError } from "@caloria/shared";
import { ANALYSIS_PROMPT_PATH, IDENTIFY_PROMPT_PATH, loadPrompt } from "./config/prompts";
import { loadWorkerConfig } from "./config/worker";
import { connectMongo } from "./config/db";
import { createAnalyzeMeal } from "./jobs/analyze-meal";
import { MEAL_ANALYSIS_QUEUE } from "./jobs/meal-analysis";
import { createMealAnalysisProcessor } from "./jobs/meal-analysis-processor";
import { createMealAnalysisWorker } from "./jobs/meal-analysis-worker";
import { createOpenAiDishIdentifier } from "./services/dish-identifier";
import { createMediaService } from "./services/media";
import { createMongoSimilarMealsFinder } from "./services/similar-meals";
import { createOpenAiTranscription } from "./services/transcription";
import { createOpenAiVision } from "./services/vision";

const logger = createLogger({ service: "worker" });

async function main() {
  const config = loadWorkerConfig();
  // Se leen una sola vez: sin archivo o sin versión, el worker no arranca.
  const prompt = loadPrompt(ANALYSIS_PROMPT_PATH);
  const identifyPrompt = loadPrompt(IDENTIFY_PROMPT_PATH);
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
    model: config.openai.visionModel,
    transcriptionModel: config.openai.transcriptionModel,
    promptVersion: prompt.version,
    identifyPromptVersion: identifyPrompt.version,
  });
}

main().catch((err: unknown) => {
  logger.error("worker no pudo arrancar", { err: serializeError(err, { stack: true }) });
  process.exit(1);
});

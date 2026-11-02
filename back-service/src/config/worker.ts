import { loadStorageConfig } from "./storage";

export const DEFAULT_WORKER_CONCURRENCY = 2;
// El más eficiente de la familia vigente (GPT-6), con entrada de imagen y structured outputs.
export const DEFAULT_OPENAI_VISION_MODEL = "gpt-6-luna";
// El speech-to-text vigente para audios grabados; acepta M4A.
export const DEFAULT_OPENAI_TRANSCRIPTION_MODEL = "gpt-transcribe";
// Texto del Wrapped: el rápido y eficiente de la familia vigente, con structured outputs.
export const DEFAULT_OPENAI_TEXT_MODEL = "gpt-6.1-terra";
// Comentario por tono (RF-11): el más barato y rápido vigente; acepta structured outputs y reasoning "low".
export const DEFAULT_OPENAI_COMMENT_MODEL = "gpt-6-luna";

/**
 * Config del Worker. Aparte de `loadConfig` para que la clave privada de JWT no le llegue
 * y la de OpenAI no le llegue al Back. Lanza si falta algo obligatorio: el worker no arranca.
 */
export function loadWorkerConfig(env = process.env) {
  const mongoUri = env.MONGO_URI?.trim();
  if (!mongoUri) throw new Error("Falta la variable de entorno MONGO_URI");
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) throw new Error("Falta la variable de entorno REDIS_URL");
  const openaiApiKey = env.OPENAI_API_KEY?.trim();
  if (!openaiApiKey) throw new Error("Falta la variable de entorno OPENAI_API_KEY");
  return {
    mongoUri,
    redisUrl,
    concurrency: parseConcurrency(env.WORKER_CONCURRENCY),
    storage: loadStorageConfig(env),
    openai: {
      apiKey: openaiApiKey,
      visionModel: env.OPENAI_VISION_MODEL?.trim() || DEFAULT_OPENAI_VISION_MODEL,
      transcriptionModel:
        env.OPENAI_TRANSCRIPTION_MODEL?.trim() || DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
      textModel: env.OPENAI_TEXT_MODEL?.trim() || DEFAULT_OPENAI_TEXT_MODEL,
      commentModel: env.OPENAI_COMMENT_MODEL?.trim() || DEFAULT_OPENAI_COMMENT_MODEL,
    },
    // Opcional: solo si el proyecto tiene activada la seguridad de push en EAS.
    expo: { accessToken: env.EXPO_ACCESS_TOKEN?.trim() || undefined },
  };
}

function parseConcurrency(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_WORKER_CONCURRENCY;
  const concurrency = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error(`WORKER_CONCURRENCY tiene que ser un entero positivo (vino "${value}")`);
  }
  return concurrency;
}

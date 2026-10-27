import OpenAI, { toFile } from "openai";

// Tope de la llamada de transcripción. Sin reintentos del SDK: los reintentos son de BullMQ.
export const TRANSCRIPTION_TIMEOUT_MS = 30_000;
// Idioma del audio (ISO-639-1): ayuda a la precisión y a la latencia.
export const TRANSCRIPTION_LANGUAGE = "es";

export interface TranscriptionService {
  /** Modelo de speech-to-text, para el log. */
  readonly model: string;
  /** Transcribe el audio M4A. Devuelve "" si no hay habla (vacío o solo ruido). */
  transcribe(audio: Uint8Array): Promise<string>;
}

/**
 * Limpia lo que devolvió el modelo. Sin letras ni números (o solo anotaciones como
 * "[música]" o "(ruido)") no hay nada que sirva de contexto: queda "".
 */
export function cleanTranscript(text: string): string {
  const trimmed = text.trim();
  const speech = trimmed.replace(/\[[^\]]*\]|\([^)]*\)/g, "");
  return /[\p{L}\p{N}]/u.test(speech) ? trimmed : "";
}

export interface OpenAiTranscriptionOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  /** Solo para tests: reemplaza el fetch del SDK. */
  fetch?: typeof globalThis.fetch;
}

export function createOpenAiTranscription({
  apiKey,
  model,
  timeoutMs = TRANSCRIPTION_TIMEOUT_MS,
  fetch,
}: OpenAiTranscriptionOptions): TranscriptionService {
  const client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0, ...(fetch && { fetch }) });
  // gpt-transcribe recibe el idioma en `languages`; los modelos anteriores, en `language`.
  const language = model.startsWith("gpt-transcribe")
    ? { languages: [TRANSCRIPTION_LANGUAGE] }
    : { language: TRANSCRIPTION_LANGUAGE };

  return {
    model,
    async transcribe(audio) {
      // AAC en MP4, tal cual lo graba la app: la API lo identifica por la extensión y el tipo.
      const file = await toFile(audio, "audio.m4a", { type: "audio/mp4" });
      const response = await client.audio.transcriptions.create({
        file,
        model,
        ...language,
        response_format: "json",
      });
      return cleanTranscript(response.text);
    },
  };
}

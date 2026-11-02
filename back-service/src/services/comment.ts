import OpenAI from "openai";
import { z } from "zod";
import type { Tone } from "@caloria/shared";
import type { Prompt } from "../config/prompts";
import type { FoodAnalysis, TokenUsage, VisionIssue } from "./vision";

// Va después de la visión, dentro de los 15 s de RNF-01: corto y sin reintentos del SDK.
export const COMMENT_TIMEOUT_MS = 8_000;
export const COMMENT_MAX_CHARS = 200;
// Tope de tokens de salida: alcanza de sobra para 200 caracteres en JSON.
export const COMMENT_MAX_OUTPUT_TOKENS = 300;

/** Los tonos que generan comentario: con "off" no se llama a la IA. */
export type CommentTone = Exclude<Tone, "off">;

/** Lo único del análisis que ve la IA: nada de la foto, la nota, el transcript ni el perfil. */
export type CommentAnalysis = Pick<FoodAnalysis, "dish" | "items" | "kcal" | "macros">;

export interface CommentInput {
  tone: CommentTone;
  analysis: CommentAnalysis;
}

export interface CommentResult {
  text: string;
  usage?: TokenUsage;
}

export interface CommentService {
  /** Modelo y versión de prompts/roast.md, para el log. */
  readonly model: string;
  readonly promptVersion: string;
  /** Genera el comentario. Lanza InvalidCommentResponseError si la respuesta no pasa la validación. */
  comment(input: CommentInput): Promise<CommentResult>;
}

export class InvalidCommentResponseError extends Error {
  constructor(
    readonly issues: VisionIssue[],
    readonly usage?: TokenUsage,
  ) {
    super("La respuesta de la IA no cumple el esquema del comentario");
    this.name = "InvalidCommentResponseError";
  }
}

// Si viene largo se rechaza: no se corta a mano.
const responseSchema = z.object({
  text: z.string().trim().min(1).max(COMMENT_MAX_CHARS),
});

/** Valida el texto que devolvió la IA. Lo usa el service de OpenAI y los fakes de los tests. */
export function parseCommentResponse(text: string, usage?: TokenUsage): CommentResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new InvalidCommentResponseError(
      [{ path: "", code: "invalid_json", message: "La respuesta no es JSON" }],
      usage,
    );
  }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(({ path, code, message }) => ({
      path: path.join("."),
      code,
      message,
    }));
    throw new InvalidCommentResponseError(issues, usage);
  }
  return { text: parsed.data.text, ...(usage && { usage }) };
}

// JSON schema para structured outputs (strict). El largo lo controla zod.
export const COMMENT_JSON_SCHEMA = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
  additionalProperties: false,
};

/** Mensaje del usuario: el tono y el análisis, campo por campo, como JSON. */
export function commentMessage({ tone, analysis }: CommentInput): string {
  const { dish, items, kcal, macros } = analysis;
  return JSON.stringify({
    tone,
    analysis: {
      dish,
      items: items.map(({ name, grams, kcal }) => ({ name, grams, kcal })),
      kcal,
      macros: { protein: macros.protein, carbs: macros.carbs, fat: macros.fat },
    },
  });
}

export interface OpenAiCommentOptions {
  apiKey: string;
  model: string;
  prompt: Prompt;
  timeoutMs?: number;
  /** Solo para tests: reemplaza el fetch del SDK. */
  fetch?: typeof globalThis.fetch;
}

export function createOpenAiCommenter({
  apiKey,
  model,
  prompt,
  timeoutMs = COMMENT_TIMEOUT_MS,
  fetch,
}: OpenAiCommentOptions): CommentService {
  const client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0, ...(fetch && { fetch }) });

  return {
    model,
    promptVersion: prompt.version,
    async comment(input) {
      const response = await client.responses.create({
        model,
        instructions: prompt.system,
        input: [{ role: "user", content: [{ type: "input_text", text: commentMessage(input) }] }],
        text: {
          format: {
            type: "json_schema",
            name: "comentario",
            schema: COMMENT_JSON_SCHEMA,
            strict: true,
          },
        },
        // Explícito para no depender del default del modelo. Con "none", gpt-6-luna sigue
        // escribiendo después del JSON (lo repite o agrega basura) y la respuesta no valida.
        reasoning: { effort: "low" },
        max_output_tokens: COMMENT_MAX_OUTPUT_TOKENS,
        store: false,
      });

      const { usage: raw } = response;
      const usage = raw && {
        input: raw.input_tokens,
        output: raw.output_tokens,
        total: raw.total_tokens,
      };
      if (response.status !== "completed") {
        const reason = response.incomplete_details?.reason ?? response.status ?? "sin estado";
        throw new InvalidCommentResponseError(
          [{ path: "", code: "incomplete", message: `Respuesta incompleta: ${reason}` }],
          usage,
        );
      }
      // Una negativa no sigue el esquema: se trata como respuesta inválida.
      const refused = response.output.some(
        (item) => item.type === "message" && item.content.some((part) => part.type === "refusal"),
      );
      if (refused) {
        throw new InvalidCommentResponseError(
          [{ path: "", code: "refusal", message: "La IA se negó a responder" }],
          usage,
        );
      }
      return parseCommentResponse(response.output_text, usage);
    },
  };
}

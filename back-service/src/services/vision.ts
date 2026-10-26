import OpenAI from "openai";
import type { ResponseInputContent } from "openai/resources/responses/responses";
import { z } from "zod";
import type { AnalysisPrompt } from "../config/analysis-prompt";
import type { MealAnalysis } from "../models/Meal";
import type { VisionImage } from "./vision-image";

// Tope de la llamada a la IA. Sin reintentos del SDK: los reintentos son de BullMQ.
export const VISION_TIMEOUT_MS = 45_000;

export type FoodAnalysis = Omit<MealAnalysis, "promptVersion" | "model">;

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

/** Con qué se hizo la llamada: va al log y a la meal. */
export interface VisionCallInfo {
  model: string;
  promptVersion: string;
  usage?: TokenUsage;
}

export type VisionResult = VisionCallInfo &
  ({ isFood: true; analysis: FoodAnalysis } | { isFood: false });

export interface VisionService {
  /** Analiza la foto. Lanza InvalidVisionResponseError si la respuesta no pasa la validación. */
  analyze(image: VisionImage): Promise<VisionResult>;
}

/** Lo que se puede loguear de una validación fallida: nunca la respuesta cruda. */
export interface VisionIssue {
  path: string;
  code: string;
  message: string;
}

export class InvalidVisionResponseError extends Error {
  constructor(
    readonly issues: VisionIssue[],
    readonly info: VisionCallInfo,
  ) {
    super("La respuesta de la IA no cumple el esquema del análisis");
    this.name = "InvalidVisionResponseError";
  }
}

const range = z
  .object({ min: z.number().nonnegative(), max: z.number().nonnegative() })
  .refine(({ min, max }) => min <= max, { message: "min > max" });

const foodAnalysisSchema = z.object({
  dish: z.string().trim().min(1),
  items: z.array(z.object({ name: z.string().trim().min(1), grams: range, kcal: range })),
  kcal: range,
  macros: z.object({ protein: range, carbs: range, fat: range }),
  confidence: z.number().min(0).max(1),
});

// Si no es comida, lo que venga en `analysis` se ignora.
const responseSchema = z.discriminatedUnion("isFood", [
  z.object({ isFood: z.literal(true), analysis: foodAnalysisSchema }),
  z.object({ isFood: z.literal(false) }),
]);

/** Valida el texto que devolvió la IA. Lo usa el service de OpenAI y los fakes de los tests. */
export function parseVisionResponse(text: string, info: VisionCallInfo): VisionResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new InvalidVisionResponseError(
      [{ path: "", code: "invalid_json", message: "La respuesta no es JSON" }],
      info,
    );
  }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(({ path, code, message }) => ({
      path: path.join("."),
      code,
      message,
    }));
    throw new InvalidVisionResponseError(issues, info);
  }
  return parsed.data.isFood
    ? { ...info, isFood: true, analysis: parsed.data.analysis }
    : { ...info, isFood: false };
}

// JSON schema para structured outputs (strict): todo required y sin propiedades extra.
// No puede expresar min ≤ max; eso lo controla zod.
const RANGE_JSON_SCHEMA = {
  type: "object",
  properties: { min: { type: "number", minimum: 0 }, max: { type: "number", minimum: 0 } },
  required: ["min", "max"],
  additionalProperties: false,
};

export const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    isFood: { type: "boolean" },
    analysis: {
      anyOf: [
        {
          type: "object",
          properties: {
            dish: { type: "string" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  grams: RANGE_JSON_SCHEMA,
                  kcal: RANGE_JSON_SCHEMA,
                },
                required: ["name", "grams", "kcal"],
                additionalProperties: false,
              },
            },
            kcal: RANGE_JSON_SCHEMA,
            macros: {
              type: "object",
              properties: {
                protein: RANGE_JSON_SCHEMA,
                carbs: RANGE_JSON_SCHEMA,
                fat: RANGE_JSON_SCHEMA,
              },
              required: ["protein", "carbs", "fat"],
              additionalProperties: false,
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["dish", "items", "kcal", "macros", "confidence"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
  },
  required: ["isFood", "analysis"],
  additionalProperties: false,
};

/** Mensaje del usuario. La transcripción y la nota (#23) se suman como partes `input_text`. */
function userContent(image: VisionImage): ResponseInputContent[] {
  const base64 = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  return [
    {
      type: "input_image",
      image_url: `data:${image.contentType};base64,${base64.toString("base64")}`,
      detail: "auto",
    },
  ];
}

export interface OpenAiVisionOptions {
  apiKey: string;
  model: string;
  prompt: AnalysisPrompt;
  timeoutMs?: number;
  /** Solo para tests: reemplaza el fetch del SDK. */
  fetch?: typeof globalThis.fetch;
}

export function createOpenAiVision({
  apiKey,
  model,
  prompt,
  timeoutMs = VISION_TIMEOUT_MS,
  fetch,
}: OpenAiVisionOptions): VisionService {
  const client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0, ...(fetch && { fetch }) });

  return {
    async analyze(image) {
      const response = await client.responses.create({
        model,
        instructions: prompt.system,
        input: [{ role: "user", content: userContent(image) }],
        text: {
          format: {
            type: "json_schema",
            name: "analisis_comida",
            schema: RESPONSE_JSON_SCHEMA,
            strict: true,
          },
        },
        // Las fotos no quedan guardadas del lado de OpenAI.
        store: false,
      });

      const { usage } = response;
      const info: VisionCallInfo = {
        model: response.model,
        promptVersion: prompt.version,
        ...(usage && {
          usage: {
            input: usage.input_tokens,
            output: usage.output_tokens,
            total: usage.total_tokens,
          },
        }),
      };
      if (response.status !== "completed") {
        const reason = response.incomplete_details?.reason ?? response.status ?? "sin estado";
        throw new InvalidVisionResponseError(
          [{ path: "", code: "incomplete", message: `Respuesta incompleta: ${reason}` }],
          info,
        );
      }
      // Una negativa no sigue el esquema: se trata como respuesta inválida.
      const refused = response.output.some(
        (item) => item.type === "message" && item.content.some((part) => part.type === "refusal"),
      );
      if (refused) {
        throw new InvalidVisionResponseError(
          [{ path: "", code: "refusal", message: "La IA se negó a responder" }],
          info,
        );
      }
      return parseVisionResponse(response.output_text, info);
    },
  };
}

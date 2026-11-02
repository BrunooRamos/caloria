import OpenAI from "openai";
import { z } from "zod";
import type { Prompt } from "../config/prompts";
import type { TokenUsage } from "./vision";
import type { VisionImage } from "./vision-image";

export const IDENTIFY_TIMEOUT_MS = 6_000;
// Topes de lo que se usa para buscar: alcanza con el plato y los ingredientes principales.
export const IDENTIFY_MAX_ITEMS = 8;
const NAME_MAX_CHARS = 100;

export interface IdentifiedDish {
  /** "" si la IA no ve comida. */
  dish: string;
  items: string[];
}

export interface IdentifyResult extends IdentifiedDish {
  model: string;
  promptVersion: string;
  usage?: TokenUsage;
}

/**
 * Identifica el plato de la foto, solo para buscar comidas corregidas parecidas antes del
 * análisis. No decide si es comida ni estima nada: eso es del análisis.
 */
export interface DishIdentifier {
  identify(image: VisionImage): Promise<IdentifyResult>;
}

const name = z
  .string()
  .trim()
  .transform((value) => value.slice(0, NAME_MAX_CHARS));
const responseSchema = z.object({
  dish: name,
  items: z.array(name).transform((items) => items.filter(Boolean).slice(0, IDENTIFY_MAX_ITEMS)),
});

export const IDENTIFY_JSON_SCHEMA = {
  type: "object",
  properties: {
    dish: { type: "string" },
    items: { type: "array", items: { type: "string" } },
  },
  required: ["dish", "items"],
  additionalProperties: false,
};

export interface OpenAiDishIdentifierOptions {
  apiKey: string;
  model: string;
  prompt: Prompt;
  timeoutMs?: number;
  /** Solo para tests: reemplaza el fetch del SDK. */
  fetch?: typeof globalThis.fetch;
}

export function createOpenAiDishIdentifier({
  apiKey,
  model,
  prompt,
  timeoutMs = IDENTIFY_TIMEOUT_MS,
  fetch,
}: OpenAiDishIdentifierOptions): DishIdentifier {
  // Sin reintentos: si falla, el análisis sigue sin esta llamada.
  const client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0, ...(fetch && { fetch }) });

  return {
    async identify(image) {
      const base64 = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
      const response = await client.responses.create({
        model,
        instructions: prompt.system,
        input: [
          {
            role: "user",
            // Solo la foto, en baja resolución: alcanza para nombrar el plato y cuesta poco. Sin la
            // nota ni la transcripción, así no hay texto del usuario en esta llamada.
            content: [
              {
                type: "input_image",
                image_url: `data:${image.contentType};base64,${base64.toString("base64")}`,
                detail: "low",
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "plato_identificado",
            schema: IDENTIFY_JSON_SCHEMA,
            strict: true,
          },
        },
        store: false,
      });
      if (response.status !== "completed") {
        throw new Error(`Identificación incompleta: ${response.status ?? "sin estado"}`);
      }
      const parsed = responseSchema.parse(JSON.parse(response.output_text));
      const { usage } = response;
      return {
        ...parsed,
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
    },
  };
}

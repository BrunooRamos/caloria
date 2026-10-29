import OpenAI from "openai";
import { z } from "zod";
import {
  WRAPPED_INSIGHT_MAX_CHARS,
  WRAPPED_INSIGHTS_MAX,
  WRAPPED_INSIGHTS_MIN,
} from "@caloria/shared";
import type { Prompt } from "../config/prompt";
import type { TokenUsage } from "./vision";
import type { WeeklyData } from "./weekly-metrics";

// Tope de la llamada a la IA. Sin reintentos del SDK: los reintentos son de BullMQ.
export const INSIGHTS_TIMEOUT_MS = 60_000;

/** Con qué se hizo la llamada: va al log y al resumen. */
export interface InsightsCallInfo {
  model: string;
  promptVersion: string;
  usage?: TokenUsage;
}

export type InsightsResult = InsightsCallInfo & { insights: string[] };

export interface InsightsService {
  /** Genera los insights de la semana. Lanza InvalidInsightsResponseError si no pasan zod. */
  generate(data: WeeklyData): Promise<InsightsResult>;
}

/** Lo que se puede loguear de una validación fallida: nunca la respuesta cruda. */
export interface InsightsIssue {
  path: string;
  code: string;
  message: string;
}

export class InvalidInsightsResponseError extends Error {
  constructor(
    readonly issues: InsightsIssue[],
    readonly info: InsightsCallInfo,
  ) {
    super("La respuesta de la IA no cumple el esquema de los insights");
    this.name = "InvalidInsightsResponseError";
  }
}

const responseSchema = z.object({
  insights: z
    .array(z.string().trim().min(1).max(WRAPPED_INSIGHT_MAX_CHARS))
    .min(WRAPPED_INSIGHTS_MIN)
    .max(WRAPPED_INSIGHTS_MAX),
});

/** Valida el texto que devolvió la IA. Lo usa el service de OpenAI y los fakes de los tests. */
export function parseInsightsResponse(text: string, info: InsightsCallInfo): InsightsResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new InvalidInsightsResponseError(
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
    throw new InvalidInsightsResponseError(issues, info);
  }
  return { ...info, insights: parsed.data.insights };
}

// JSON schema para structured outputs (strict). El largo de cada string no se puede expresar
// en strict: lo controla zod.
export const INSIGHTS_JSON_SCHEMA = {
  type: "object",
  properties: {
    insights: {
      type: "array",
      items: { type: "string" },
      minItems: WRAPPED_INSIGHTS_MIN,
      maxItems: WRAPPED_INSIGHTS_MAX,
    },
  },
  required: ["insights"],
  additionalProperties: false,
};

// Rótulo del mensaje del usuario: el prompt de sistema lo nombra.
export const WEEK_DATA_LABEL = "Datos de la semana:";

const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/**
 * Lo único que ve la IA: métricas y datos agregados por día. Nunca fotos, transcripciones ni
 * notas. Las claves van en español porque el prompt las nombra así.
 */
export function insightsInput({ week, from, to, metrics, days }: WeeklyData): string {
  const data = {
    semana: week,
    desde: from,
    hasta: to,
    metricas: {
      promedioKcal: metrics.avgKcal,
      diasRegistrados: metrics.daysLogged,
      rachaDias: metrics.streak,
      platoMasFrecuente: metrics.topDish,
    },
    dias: days.map((day, i) => ({
      fecha: day.date,
      dia: WEEKDAYS[i],
      comidas: day.meals,
      ...(day.kcal !== undefined && { kcal: day.kcal }),
      platos: day.dishes,
    })),
  };
  return `${WEEK_DATA_LABEL}\n${JSON.stringify(data, null, 2)}`;
}

export interface OpenAiInsightsOptions {
  apiKey: string;
  model: string;
  prompt: Prompt;
  timeoutMs?: number;
  /** Solo para tests: reemplaza el fetch del SDK. */
  fetch?: typeof globalThis.fetch;
}

export function createOpenAiInsights({
  apiKey,
  model,
  prompt,
  timeoutMs = INSIGHTS_TIMEOUT_MS,
  fetch,
}: OpenAiInsightsOptions): InsightsService {
  const client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0, ...(fetch && { fetch }) });

  return {
    async generate(data) {
      const response = await client.responses.create({
        model,
        instructions: prompt.system,
        input: [{ role: "user", content: [{ type: "input_text", text: insightsInput(data) }] }],
        text: {
          format: {
            type: "json_schema",
            name: "insights_wrapped",
            schema: INSIGHTS_JSON_SCHEMA,
            strict: true,
          },
        },
        store: false,
      });

      const { usage } = response;
      const info: InsightsCallInfo = {
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
        throw new InvalidInsightsResponseError(
          [{ path: "", code: "incomplete", message: `Respuesta incompleta: ${reason}` }],
          info,
        );
      }
      // Una negativa no sigue el esquema: se trata como respuesta inválida.
      const refused = response.output.some(
        (item) => item.type === "message" && item.content.some((part) => part.type === "refusal"),
      );
      if (refused) {
        throw new InvalidInsightsResponseError(
          [{ path: "", code: "refusal", message: "La IA se negó a responder" }],
          info,
        );
      }
      return parseInsightsResponse(response.output_text, info);
    },
  };
}

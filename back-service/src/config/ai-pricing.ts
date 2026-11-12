/**
 * Precios de la API de OpenAI en USD, para estimar el costo de cada llamada (RNF-07). Son los de
 * lista al 2026-11 (https://developers.openai.com/api/docs/pricing), sin descuentos de batch ni
 * de input cacheado: el costo que se registra es una cota superior. Si cambian o se usa otro
 * modelo, se actualiza esta tabla; un modelo que no está acá se registra con costo null.
 */
export interface TokenPrice {
  /** USD por millón de tokens de entrada. */
  inputPerMillion: number;
  /** USD por millón de tokens de salida. */
  outputPerMillion: number;
}

export interface MinutePrice {
  /** USD por minuto de audio. */
  perMinute: number;
}

export const AI_PRICING: Record<string, TokenPrice | MinutePrice> = {
  "gpt-6-luna": { inputPerMillion: 0.1, outputPerMillion: 0.5 },
  "gpt-6.1-terra": { inputPerMillion: 1, outputPerMillion: 5 },
  "gpt-transcribe": { perMinute: 0.0045 },
};

export interface CostInput {
  model: string;
  /** Tokens de entrada y salida, en los modelos que cobran por token. */
  usage?: { input: number; output: number };
  /** Segundos de audio, en los que cobran por minuto. */
  audioSeconds?: number;
}

/**
 * Precio del modelo. La API devuelve el modelo con fecha ("gpt-6-luna-2026-10-05"): si no está
 * tal cual, se busca el prefijo más largo que coincida.
 */
export function priceFor(model: string): TokenPrice | MinutePrice | undefined {
  if (AI_PRICING[model]) return AI_PRICING[model];
  const match = Object.keys(AI_PRICING)
    .filter((name) => model.startsWith(`${name}-`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? AI_PRICING[match] : undefined;
}

/** Costo estimado en USD, o null si no hay precio o faltan los datos para calcularlo. */
export function estimateCostUsd({ model, usage, audioSeconds }: CostInput): number | null {
  const price = priceFor(model);
  if (!price) return null;
  if ("perMinute" in price) {
    return audioSeconds === undefined ? null : (audioSeconds / 60) * price.perMinute;
  }
  if (!usage) return null;
  return (usage.input * price.inputPerMillion + usage.output * price.outputPerMillion) / 1_000_000;
}

import type { ConfidenceLevel } from "@/components";

/**
 * Dónde empieza cada nivel de `confidence`. Debajo de
 * `medium` la estimación está más cerca de adivinar que de saber.
 */
export const CONFIDENCE_THRESHOLDS = { high: 0.75, medium: 0.5 } as const;

export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= CONFIDENCE_THRESHOLDS.high) return "high";
  if (confidence >= CONFIDENCE_THRESHOLDS.medium) return "medium";
  return "low";
}

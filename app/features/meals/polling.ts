/**
 * Ritmo de `GET /meals/:id` mientras la comida se analiza.
 */
export const POLLING = {
  firstDelayMs: 1_000,
  factor: 1.5,
  maxDelayMs: 5_000,
  /** Desde acá se avisa que tarda más de lo normal y se consulta menos. */
  slowAfterMs: 30_000,
  slowDelayMs: 15_000,
  /** Más del doble del peor caso: se deja de consultar solo y se ofrece volver a consultar. */
  stallAfterMs: 10 * 60_000,
} as const;

/** Espera antes de la consulta número `attempt + 1`, a `elapsedMs` de haber empezado. */
export function nextDelay(attempt: number, elapsedMs: number): number {
  if (elapsedMs >= POLLING.slowAfterMs) return POLLING.slowDelayMs;
  return Math.min(POLLING.firstDelayMs * POLLING.factor ** attempt, POLLING.maxDelayMs);
}

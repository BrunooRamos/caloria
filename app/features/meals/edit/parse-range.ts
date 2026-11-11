import type { Range } from "@/services/meals";

export const RANGE_VALUE_MAX = 99_999;
export const RANGE_TEXT_MAX_CHARS = 20;

export const RANGE_ERRORS = {
  negative: "No puede ser negativo.",
  decimal: "Usá números enteros, sin comas ni puntos.",
  tooLarge: `Usá números hasta ${RANGE_VALUE_MAX.toLocaleString("es")}.`,
  invalid: "Escribí un número o un rango (600-700).",
};

export type ParsedRange = { range: Range } | { error: string };

const RANGE = /^(\d+)\s*(?:-|–|—|a)\s*(\d+)$/i;
const NUMBER = /^\d+$/;
const UNIT = /\s*(?:g|gr|grs|gramos|kcal|cal)\.?$/i;

export function parseRange(text: string, empty = "Ingresá un valor."): ParsedRange {
  const trimmed = text.trim();
  if (trimmed === "") return { error: empty };
  // Solo si queda algo antes: "g" sola no es un valor.
  const value = /\d/.test(trimmed) ? trimmed.replace(UNIT, "") : trimmed;

  let range: Range;
  const pair = RANGE.exec(value);
  if (pair) {
    const [low, high] = [Number(pair[1]), Number(pair[2])].sort((a, b) => a - b);
    range = { min: low, max: high };
  } else if (NUMBER.test(value)) {
    range = { min: Number(value), max: Number(value) };
  } else {
    return { error: unreadable(value) };
  }

  if (range.max > RANGE_VALUE_MAX) return { error: RANGE_ERRORS.tooLarge };
  return { range };
}

/** Por qué no se entiende, para decirlo en el error. */
function unreadable(value: string): string {
  // Un menos adelante, o "600 - -700": negativo. "600-" sin el máximo no cuenta.
  if (/^[-−]\s*\d/.test(value) || /(?:-|–|—|a)\s*[-−]\s*\d/i.test(value)) {
    return RANGE_ERRORS.negative;
  }
  if (/\d[.,]\d/.test(value)) return RANGE_ERRORS.decimal;
  return RANGE_ERRORS.invalid;
}

export function formatRangeInput({ min, max }: Range): string {
  const low = Math.round(min);
  const high = Math.round(max);
  return low === high ? String(low) : `${low}-${high}`;
}

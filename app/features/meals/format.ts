import type { Range } from "@/services/meals";

/**
 * Un rango como se muestra en toda la app: `620–780 kcal`, `38–46 g`. Guion medio sin espacios y
 * la unidad al final. Cada extremo se redondea al entero; si quedan iguales, va un solo número
 * (`620 kcal`). Sin separador de miles: con cuatro cifras no se usa y al lado del guion confunde.
 */
export function formatRange({ min, max }: Range, unit: string): string {
  const low = Math.round(min);
  const high = Math.round(max);
  return `${low === high ? low : `${low}–${high}`} ${unit}`;
}

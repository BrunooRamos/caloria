import type { Meal, Range } from "@/services/meals";

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

/** Segundos como reloj: `0:42`, `1:00`. Redondea hacia arriba, como una cuenta regresiva. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Lo que dice la fila de una comida (inicio e historial), según su `status`. */
export function mealSummary(meal: Meal): { title: string; detail: string } {
  switch (meal.status) {
    case "ready":
      return { title: meal.dish, detail: formatRange(meal.kcal, "kcal") };
    case "processing":
      return { title: "Analizando…", detail: "Todavía no suma en el total del día." };
    case "failed":
      // Sin rojo ni alarma: el detalle explica qué pasó.
      return { title: "No se pudo analizar", detail: "No suma en el total del día." };
  }
}

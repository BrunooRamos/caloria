import { formatRange } from "@/features/meals/format";
import type { Meal } from "@/services/meals";

/** Lo que dice la fila de una comida en el historial, según su `status`. */
export function mealSummary(meal: Meal): { title: string; detail: string } {
  switch (meal.status) {
    case "ready":
      return { title: meal.dish, detail: formatRange(meal.kcal, "kcal") };
    case "processing":
      return { title: "Analizando…", detail: "Todavía no suma en el total del día." };
    case "failed":
      // Sin rojo ni alarma, como en el dashboard: el detalle explica qué pasó.
      return { title: "No se pudo analizar", detail: "No suma en el total del día." };
  }
}

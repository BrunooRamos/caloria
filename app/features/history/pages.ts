import type { Meal } from "@/services/meals";

/**
 * Suma una página nueva al final de lo que ya se mostró. Si una comida ya estaba (por ejemplo, la
 * lista cambió entre una página y la otra), queda la versión más nueva en su lugar y no se repite.
 */
export function mergePage(current: readonly Meal[], page: readonly Meal[]): Meal[] {
  const incoming = new Map(page.map((meal) => [meal.id, meal]));
  const merged = current.map((meal) => {
    const fresh = incoming.get(meal.id);
    if (!fresh) return meal;
    incoming.delete(meal.id);
    return fresh;
  });
  // `incoming` conserva el orden de la página: van las que no estaban.
  return [...merged, ...incoming.values()];
}

/** La lista sin la comida `id`; si no estaba, la misma lista. */
export function removeMeal(current: readonly Meal[], id: string): readonly Meal[] {
  return current.some((meal) => meal.id === id)
    ? current.filter((meal) => meal.id !== id)
    : current;
}

import { createContext, use, useState, useSyncExternalStore } from "react";
import type { PropsWithChildren } from "react";
import type { Meal } from "@/services/meals";

/**
 * Las comidas abiertas, por id, para que el detalle y la corrección muestren lo mismo: al guardar
 * una corrección, el detalle ve la comida nueva sin volver a pedirla. Vive en memoria mientras
 * dura la sesión; quien abre una comida la borra al cerrarla.
 */
export interface MealCache {
  get(id: string): Meal | undefined;
  set(id: string, meal: Meal): void;
  delete(id: string): void;
  subscribe(listener: () => void): () => void;
}

export function createMealCache(): MealCache {
  const meals = new Map<string, Meal>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    get: (id) => meals.get(id),
    set(id, meal) {
      meals.set(id, meal);
      notify();
    },
    delete(id) {
      if (meals.delete(id)) notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const MealCacheContext = createContext<MealCache | null>(null);

export function MealCacheProvider({ children }: PropsWithChildren) {
  const [cache] = useState(createMealCache);
  return <MealCacheContext value={cache}>{children}</MealCacheContext>;
}

export function useMealCache(): MealCache {
  const cache = use(MealCacheContext);
  if (!cache) throw new Error("useMealCache tiene que usarse dentro de <MealCacheProvider>");
  return cache;
}

/** La comida guardada con ese id, o `null`; se actualiza cuando cambia. */
export function useCachedMeal(id: string): Meal | null {
  const cache = useMealCache();
  return useSyncExternalStore(cache.subscribe, () => cache.get(id) ?? null);
}

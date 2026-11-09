import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { listMealsByDay } from "@/services/meals";
import type { Meal } from "@/services/meals";
import { mergePage } from "./pages";

export type DayMealsState =
  | { status: "loading" }
  /** `stale`: falló el último refresco y se muestra lo que ya había. */
  | { status: "ready"; meals: readonly Meal[]; nextCursor: string | null; stale: boolean }
  | { status: "error"; error: unknown };

/** Lo guardado es de un día; si cambia el día, se vuelve a cargar desde cero. */
type Stored = { day: string } & DayMealsState;

/**
 * Las comidas de `day`, en el historial y en el inicio: la primera página al ganar el foco o
 * cambiar de día (así se ve lo corregido o borrado en otra pantalla) y las siguientes con el cursor,
 * de a una por vez.
 */
export function useDayMeals(day: string) {
  const [stored, setStored] = useState<Stored>({ day, status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Del día en que falló: al cambiar de día no se arrastra.
  const [loadMoreFailure, setLoadMoreFailure] = useState<{ day: string; error: unknown } | null>(
    null,
  );
  const firstPage = useRef<AbortController | null>(null);
  const nextPage = useRef<AbortController | null>(null);

  const state: DayMealsState = stored.day === day ? stored : { status: "loading" };
  const loadMoreError = loadMoreFailure?.day === day ? loadMoreFailure.error : null;

  const load = useCallback(async () => {
    firstPage.current?.abort();
    // Una página siguiente en vuelo quedaría pegada a una lista vieja.
    nextPage.current?.abort();
    const controller = new AbortController();
    firstPage.current = controller;
    try {
      const page = await listMealsByDay(day, null, controller.signal);
      if (controller.signal.aborted) return;
      setStored({
        day,
        status: "ready",
        meals: page.items,
        nextCursor: page.nextCursor,
        stale: false,
      });
      setLoadMoreFailure(null);
    } catch (error) {
      if (controller.signal.aborted) return;
      // Con datos del mismo día en pantalla, un refresco que falla no los tapa.
      setStored((prev) =>
        prev.day === day && prev.status === "ready"
          ? { ...prev, stale: true }
          : { day, status: "error", error },
      );
    } finally {
      if (firstPage.current === controller) {
        firstPage.current = null;
        setRefreshing(false);
      }
    }
  }, [day]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        firstPage.current?.abort();
        nextPage.current?.abort();
      };
    }, [load]),
  );

  const cursor = state.status === "ready" ? state.nextCursor : null;

  /** La página siguiente. No hace nada sin cursor o con otra carga en vuelo. */
  const loadMore = useCallback(async () => {
    if (!cursor || firstPage.current || nextPage.current) return;
    const controller = new AbortController();
    nextPage.current = controller;
    setLoadingMore(true);
    setLoadMoreFailure(null);
    try {
      const page = await listMealsByDay(day, cursor, controller.signal);
      if (controller.signal.aborted) return;
      setStored((prev) =>
        prev.day === day && prev.status === "ready"
          ? {
              ...prev,
              meals: mergePage(prev.meals, page.items),
              nextCursor: page.nextCursor,
            }
          : prev,
      );
    } catch (error) {
      if (!controller.signal.aborted) setLoadMoreFailure({ day, error });
    } finally {
      if (nextPage.current === controller) {
        nextPage.current = null;
        setLoadingMore(false);
      }
    }
  }, [day, cursor]);

  /** Pull to refresh. */
  const refresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  /** Desde el estado de error: vuelve al esqueleto y pide de nuevo. */
  const retry = useCallback(() => {
    setStored({ day, status: "loading" });
    void load();
  }, [day, load]);

  return {
    state,
    refreshing,
    refresh,
    retry,
    /** Vuelve a pedir la primera página sin mostrar el indicador de pull to refresh. */
    reload: load,
    loadingMore,
    loadMoreError,
    loadMore,
  };
}

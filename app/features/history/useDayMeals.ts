import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ApiError } from "@/services/api-error";
import { deleteMeal, listMealsByDay } from "@/services/meals";
import type { Meal } from "@/services/meals";
import { mergePage, removeMeal } from "./pages";

export type DayMealsState =
  | { status: "loading" }
  /** `stale`: falló el último refresco y se muestra lo que ya había. */
  | { status: "ready"; meals: readonly Meal[]; nextCursor: string | null; stale: boolean }
  | { status: "error"; error: unknown };

/** Lo guardado es de un día; si cambia el día, se vuelve a cargar desde cero. */
type Stored = { day: string } & DayMealsState;

/**
 * Las comidas de `day` (RF-08): la primera página al ganar el foco o cambiar de día (así se ve lo
 * corregido o borrado en otra pantalla) y las siguientes con el cursor, de a una por vez.
 */
export function useDayMeals(day: string) {
  const [stored, setStored] = useState<Stored>({ day, status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  const firstPage = useRef<AbortController | null>(null);
  const nextPage = useRef<AbortController | null>(null);

  const state: DayMealsState = stored.day === day ? stored : { status: "loading" };

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
      setLoadMoreError(null);
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
    setLoadMoreError(null);
    try {
      const page = await listMealsByDay(day, cursor, controller.signal);
      if (controller.signal.aborted) return;
      setStored((prev) =>
        prev.day === day && prev.status === "ready"
          ? { ...prev, meals: mergePage(prev.meals, page.items), nextCursor: page.nextCursor }
          : prev,
      );
    } catch (error) {
      if (!controller.signal.aborted) setLoadMoreError(error);
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

  /**
   * Borra la comida y la saca de la lista. Un 404 cuenta como borrada (ya no estaba); cualquier
   * otro error se propaga para que la fila lo muestre.
   */
  const remove = useCallback(async (id: string) => {
    try {
      await deleteMeal(id);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
    setStored((prev) =>
      prev.status === "ready" ? { ...prev, meals: removeMeal(prev.meals, id) } : prev,
    );
  }, []);

  return { state, refreshing, refresh, retry, loadingMore, loadMoreError, loadMore, remove };
}

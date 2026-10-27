import { useFocusEffect, useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { inBackground, nextDelay, POLLING } from "@/features/meals/polling";
import { getDailyDashboard } from "@/services/dashboard";
import type { DailyDashboard } from "@/services/dashboard";

export type DashboardState =
  | { status: "loading" }
  /** `stale`: falló el último refresco y se muestra lo que ya había. */
  | { status: "ready"; dashboard: DailyDashboard; stale: boolean }
  | { status: "error"; error: unknown };

export function useDailyDashboard() {
  const [state, setState] = useState<DashboardState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [foreground, setForeground] = useState(() => !inBackground(AppState.currentState));
  const focused = useIsFocused();
  const inFlight = useRef<AbortController | null>(null);
  const focusedRef = useRef(focused);
  const pollStartedAt = useRef<number | null>(null);
  const attempt = useRef(0);

  const load = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const dashboard = await getDailyDashboard(controller.signal);
      if (!controller.signal.aborted) setState({ status: "ready", dashboard, stale: false });
    } catch (error) {
      if (controller.signal.aborted) return;
      // Con datos en pantalla, un refresco que falla no los tapa.
      setState((prev) =>
        prev.status === "ready" ? { ...prev, stale: true } : { status: "error", error },
      );
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setRefreshing(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      void load();
      return () => {
        focusedRef.current = false;
        inFlight.current?.abort();
      };
    }, [load]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      const visible = !inBackground(next);
      setForeground(visible);
      if (visible && focusedRef.current) void load();
    });
    return () => subscription.remove();
  }, [load]);

  const processing = state.status === "ready" ? state.dashboard.meals.processing : 0;
  const polling = focused && foreground && processing > 0;

  // Cada respuesta cambia `state` y agenda la siguiente; sin comidas en processing, corta.
  useEffect(() => {
    if (!polling) {
      pollStartedAt.current = null;
      attempt.current = 0;
      return;
    }
    const now = Date.now();
    pollStartedAt.current ??= now;
    const elapsed = now - pollStartedAt.current;
    // Igual que el resultado de una comida: pasado este tiempo deja de consultar solo.
    if (elapsed >= POLLING.stallAfterMs) return;
    const timer = setTimeout(() => void load(), nextDelay(attempt.current++, elapsed));
    return () => clearTimeout(timer);
  }, [polling, state, load]);

  // TODO(RF-13): cuando exista el push "análisis listo", llamar a `refresh` al recibirlo.

  /** Pull to refresh. */
  const refresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  /** Desde el estado de error: vuelve al esqueleto y pide de nuevo. */
  const retry = useCallback(() => {
    setState({ status: "loading" });
    void load();
  }, [load]);

  return { state, refreshing, refresh, retry };
}

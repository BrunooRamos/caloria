import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/services/api-error";
import { getWeeklySummary } from "@/services/summaries";
import type { WeeklySummary } from "@/services/summaries";

export type WeeklySummaryState =
  | { status: "loading" }
  | { status: "ready"; summary: WeeklySummary }
  | { status: "unavailable" }
  | { status: "premiumRequired" }
  | { status: "error"; error: unknown };

export function stateFromError(error: unknown): WeeklySummaryState {
  if (error instanceof ApiError && error.code === "NOT_FOUND") return { status: "unavailable" };
  if (error instanceof ApiError && error.code === "PREMIUM_REQUIRED") {
    return { status: "premiumRequired" };
  }
  return { status: "error", error };
}

function fetchState(week: string, signal: AbortSignal): Promise<WeeklySummaryState> {
  return getWeeklySummary(week, signal).then(
    (summary): WeeklySummaryState => ({ status: "ready", summary }),
    stateFromError,
  );
}

export function useWeeklySummary(week: string) {
  const [state, setState] = useState<WeeklySummaryState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetchState(week, controller.signal).then((next) => {
      if (!controller.signal.aborted) setState(next);
    });
    return () => controller.abort();
  }, [week, attempt]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { state, reload };
}

import type { Href } from "expo-router";
import { isValidWeek } from "@/features/wrapped/week";

/**
 * Pantalla que abre cada aviso al tocarlo, según el `data` que manda el Backend:
 * `{ type: "analysisReady", mealId }`, `{ type: "streakRisk" }` o `{ type: "wrappedReady", week }`.
 */
export function notificationRoute(data: unknown): Href | null {
  if (typeof data !== "object" || data === null) return null;
  const { type, mealId, week } = data as Record<string, unknown>;
  switch (type) {
    case "analysisReady":
      return typeof mealId === "string" && mealId !== ""
        ? { pathname: "/meals/[id]", params: { id: mealId } }
        : null;
    case "wrappedReady":
      return typeof week === "string" && isValidWeek(week)
        ? { pathname: "/wrapped/[week]", params: { week } }
        : "/wrapped";
    case "streakRisk":
      return "/";
    default:
      return null;
  }
}

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { ApiError } from "@/services/api-error";
import { getMeal } from "@/services/meals";
import type { Meal } from "@/services/meals";
import { useCachedMeal, useMealCache } from "@/store/meals";
import { inBackground, nextDelay, POLLING } from "./polling";

export interface MealPolling {
  meal: Meal | null;
  /** 404: no existe o es de otro usuario. Deja de consultar. */
  notFound: boolean;
  /** Pasó `POLLING.slowAfterMs` sin terminar: se consulta menos y el mensaje cambia. */
  slow: boolean;
  /** Pasó `POLLING.stallAfterMs`: ya no consulta solo hasta `refresh()`. */
  stalled: boolean;
  /** Falló la última consulta (sin red, 5xx). Se sigue intentando al mismo ritmo. */
  connectionIssue: boolean;
  /** Consulta ya: renueva una `photoUrl` vencida o retoma después de `stalled`. */
  refresh(): void;
}

/**
 * Consulta `GET /meals/:id` mientras la comida está en `processing`, cada vez más espaciado
 * (`nextDelay`), y corta apenas llega `ready`, `failed` o un 404. Nunca superpone pedidos: el
 * siguiente se agenda cuando termina el anterior. Con `enabled: false` (la pantalla perdió el
 * foco) o la app en segundo plano se pausa y cancela el pedido en vuelo; al volver consulta enseguida
 * y sigue desde el mismo intervalo.
 *
 * La comida queda en el store de comidas mientras el hook está montado: una corrección guardada
 * desde otra pantalla se ve acá sin volver a consultar.
 */
export function useMealPolling(id: string, { enabled = true } = {}): MealPolling {
  const cache = useMealCache();
  const meal = useCachedMeal(id);
  const [notFound, setNotFound] = useState(false);
  const [slow, setSlow] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [connectionIssue, setConnectionIssue] = useState(false);
  const [foreground, setForeground] = useState(() => !inBackground(AppState.currentState));
  const [restart, setRestart] = useState(0);
  // Se fijan al montar: Date.now() no puede llamarse durante el render.
  const startedAt = useRef(0);
  const stallFrom = useRef(0);
  const attempt = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    startedAt.current = stallFrom.current = Date.now();
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(!inBackground(state)),
    );
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, []);

  // Al cerrar la pantalla se olvida: la próxima vez que se abra, se consulta de nuevo.
  useEffect(() => () => cache.delete(id), [cache, id]);

  const finished = notFound || meal?.status === "ready" || meal?.status === "failed";
  const active = enabled && foreground && !finished && !stalled;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    async function poll() {
      try {
        const next = await getMeal(id, controller.signal);
        if (cancelled) return;
        cache.set(id, next);
        setConnectionIssue(false);
        if (next.status !== "processing") return;
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
          return;
        }
        setConnectionIssue(true);
      }
      const now = Date.now();
      if (now - stallFrom.current >= POLLING.stallAfterMs) {
        setStalled(true);
        return;
      }
      const elapsed = now - startedAt.current;
      setSlow(elapsed >= POLLING.slowAfterMs);
      timer = setTimeout(() => void poll(), nextDelay(attempt.current++, elapsed));
    }

    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, cache, id, restart]);

  const refresh = useCallback(() => {
    if (stalled) {
      stallFrom.current = Date.now();
      setStalled(false);
      return;
    }
    if (!finished) {
      setRestart((count) => count + 1);
      return;
    }
    // Comida terminada: una sola consulta, para renovar la photoUrl.
    getMeal(id)
      .then((next) => {
        if (mounted.current) cache.set(id, next);
      })
      .catch(() => {});
  }, [cache, finished, id, stalled]);

  return { meal, notFound, slow, stalled, connectionIssue, refresh };
}

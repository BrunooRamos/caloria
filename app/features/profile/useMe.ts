import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { getMe, updateNotifications, updateProfile, updateTone } from "@/services/users";
import type { Me, NotificationPreferences, Tone } from "@/services/users";
import type { ProfileInput } from "./validation";

export type MeState =
  { status: "loading" } | { status: "ready"; me: Me } | { status: "error"; error: unknown };

function fetchMe(): Promise<MeState> {
  return getMe().then(
    (me): MeState => ({ status: "ready", me }),
    (error: unknown): MeState => ({ status: "error", error }),
  );
}

/**
 * `GET /users/me` y sus cambios. Por defecto lo pide al montar; con `refreshOnFocus`, cada vez que la
 * pantalla gana el foco (el perfil, para mostrar lo que se cambió en sus secciones). Con datos en
 * pantalla, un pedido que falla no los tapa.
 */
export function useMe({ refreshOnFocus = false }: { refreshOnFocus?: boolean } = {}) {
  const [state, setState] = useState<MeState>({ status: "loading" });

  const load = useCallback(() => {
    let active = true;
    void fetchMe().then((next) => {
      if (!active) return;
      setState((prev) => (next.status === "error" && prev.status === "ready" ? prev : next));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => (refreshOnFocus ? undefined : load()), [load, refreshOnFocus]);
  useFocusEffect(useCallback(() => (refreshOnFocus ? load() : undefined), [load, refreshOnFocus]));

  const reload = useCallback(() => {
    setState({ status: "loading" });
    void fetchMe().then(setState);
  }, []);

  /** Guarda el perfil y devuelve cómo quedó, con las metas recalculadas. */
  const save = useCallback(async (changes: Partial<ProfileInput>) => {
    const me = await updateProfile(changes);
    setState({ status: "ready", me });
    return me;
  }, []);

  const saveTone = useCallback(async (tone: Tone) => {
    const me = await updateTone(tone);
    setState({ status: "ready", me });
  }, []);

  const saveNotifications = useCallback(async (changes: Partial<NotificationPreferences>) => {
    const me = await updateNotifications(changes);
    setState({ status: "ready", me });
  }, []);

  return { state, reload, save, saveTone, saveNotifications };
}

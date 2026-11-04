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

export function useMe() {
  const [state, setState] = useState<MeState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void fetchMe().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, []);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    void fetchMe().then(setState);
  }, []);

  const save = useCallback(async (changes: Partial<ProfileInput>) => {
    const me = await updateProfile(changes);
    setState({ status: "ready", me });
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

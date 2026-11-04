import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import type { ViewInstance } from "react-native";
import { captureRef } from "react-native-view-shot";
import { sizes } from "@/theme";
import type { WrappedCard, WrappedCardKind } from "./cards";

export type ShareState =
  | { status: "idle"; error: string | null }
  | { status: "capturing"; card: WrappedCard }
  | { status: "preview"; card: WrappedCard; uri: string }
  | { status: "sharing"; card: WrappedCard; uri: string };

export const CAPTURE_FAILED = "No pudimos armar la imagen. Probá de nuevo.";
export const SHARE_FAILED = "No pudimos abrir la opción de compartir. Probá de nuevo.";
export const SHARING_UNAVAILABLE = "Este dispositivo no permite compartir desde la app.";

export function toFileUri(path: string): string {
  return path.startsWith("file://") ? path : `file://${path}`;
}

const FILE_SLUG: Record<WrappedCardKind, string> = {
  week: "semana",
  avgKcal: "promedio",
  topDish: "plato",
  insights: "lo-que-vimos",
};

export function shareFileName(week: string, kind: WrappedCardKind): string {
  return `CalorIA-${week}-${FILE_SLUG[kind]}.png`;
}

function renameCapture(path: string, name: string): string {
  const file = new File(toFileUri(path));
  try {
    file.moveSync(new File(Paths.cache, name), { overwrite: true });
  } catch {
    // Queda donde estaba.
  }
  return file.uri;
}

export function deleteTempFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // El sistema limpia igual estos archivos al cerrar la app.
  }
}

export function useCardShare(week: string) {
  const [state, setState] = useState<ShareState>({ status: "idle", error: null });
  const shareCardRef = useRef<ViewInstance>(null);
  const capturing = useRef<WrappedCard | null>(null);
  const current = useRef<string | null>(null);
  const leftover = useRef<string | null>(null);

  const discard = useCallback((ref: { current: string | null }) => {
    if (ref.current) deleteTempFile(ref.current);
    ref.current = null;
  }, []);

  useEffect(
    () => () => {
      discard(current);
      discard(leftover);
    },
    [discard],
  );

  const start = useCallback(
    (card: WrappedCard) => {
      discard(leftover);
      capturing.current = card;
      setState({ status: "capturing", card });
    },
    [discard],
  );

  const capture = useCallback(async () => {
    const card = capturing.current;
    if (!card) return;
    try {
      const path = await captureRef(shareCardRef, {
        format: "png",
        result: "tmpfile",
        ...(Platform.OS === "android" ? sizes.shareImage : {}),
      });
      current.current = renameCapture(path, shareFileName(week, card.kind));
      setState({ status: "preview", card, uri: current.current });
    } catch {
      setState({ status: "idle", error: CAPTURE_FAILED });
    } finally {
      capturing.current = null;
    }
  }, [week]);

  const cancel = useCallback(() => {
    discard(current);
    setState({ status: "idle", error: null });
  }, [discard]);

  const share = useCallback(async () => {
    if (state.status !== "preview") return;
    const { card, uri } = state;
    if (!(await Sharing.isAvailableAsync())) {
      discard(current);
      setState({ status: "idle", error: SHARING_UNAVAILABLE });
      return;
    }
    setState({ status: "sharing", card, uri });
    let error: string | null = null;
    try {
      await Sharing.shareAsync(uri, {
        mimeType: "image/png",
        UTI: "public.png",
        dialogTitle: "Compartir tu semana",
      });
    } catch {
      error = SHARE_FAILED;
    }
    if (Platform.OS === "android") {
      leftover.current = current.current;
      current.current = null;
    } else {
      discard(current);
    }
    setState({ status: "idle", error });
  }, [state, discard]);

  return { state, shareCardRef, start, capture, cancel, share };
}

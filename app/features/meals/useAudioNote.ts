import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import type { RecordingOptions, RecordingStatus } from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

/** Mismo tope que valida la API (`AUDIO_MAX_SECONDS` en shared/src/meals.ts). */
export const AUDIO_MAX_SECONDS = 60;
/** Más corto que esto, MediaRecorder de Android puede dejar el M4A sin `moov`. */
export const AUDIO_MIN_MILLIS = 1000;

export const RECORD_ERROR = "No pudimos grabar el audio. Probá de nuevo.";
export const TOO_SHORT_ERROR = "El audio quedó muy corto. Grabá al menos un segundo.";

/**
 * AAC en MP4 (`.m4a`) en las dos plataformas, que es lo único que acepta la API: iOS escribe la
 * marca `M4A ` y Android `isom`/`mp42`, ambos con `moov`. Mono a 64 kbps alcanza para voz:
 * 60 s pesan ~480 KB, lejos de los 4 MB de `AUDIO_MAX_BYTES`.
 */
export const RECORDING_OPTIONS: RecordingOptions = {
  extension: ".m4a",
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 64000,
  android: { outputFormat: "mpeg4", audioEncoder: "aac" },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.HIGH },
  web: { mimeType: "audio/mp4", bitsPerSecond: 64000 },
};

export interface AudioNote {
  uri: string;
}

export type AudioNoteStatus = "idle" | "recording" | "recorded";

/** `user` incluye pasar a segundo plano: lo grabado hasta ahí queda. */
type StopReason = "user" | "limit" | "error";

/** `blocked`: el sistema ya no vuelve a preguntar, solo queda la configuración. */
export type MicPermission = "denied" | "blocked" | null;

export interface UseAudioNote {
  status: AudioNoteStatus;
  note: AudioNote | null;
  remainingSeconds: number;
  /** La grabación la cortó el límite de 60 s, no el usuario. */
  reachedLimit: boolean;
  permission: MicPermission;
  error: string | null;
  playing: boolean;
  /** Duración del audio grabado en segundos, cuando el player ya lo cargó. */
  durationSeconds: number | null;
  /** Graba de cero; con un audio ya grabado, lo reemplaza (regrabar). */
  record(): Promise<void>;
  stop(): Promise<void>;
  togglePlayback(): Promise<void>;
  stopPlayback(): void;
  discard(): void;
}

/**
 * Modo de audio. En iOS no es parcial: lo que no se pasa vuelve al default nativo, y ahí
 * `playsInSilentMode` es false, con lo que el audio no suena con el teléfono en silencio.
 * Por eso siempre se manda completo.
 */
function setRecordingMode(allowsRecording: boolean) {
  return setAudioModeAsync({ allowsRecording, playsInSilentMode: true });
}

/** Vuelve al modo de solo reproducción: en iOS, con la grabación activa el audio sale más bajo. */
function stopRecordingMode() {
  setRecordingMode(false).catch(() => {});
}

/** Audio opcional de la comida (RF-04): grabar hasta 60 s, escuchar, regrabar o descartar. */
export function useAudioNote(): UseAudioNote {
  // El listener queda fijo al crear el grabador: llama a la versión actual por ref.
  const onRecorderStatus = useRef<(status: RecordingStatus) => void>(() => {});
  const recorder = useAudioRecorder(RECORDING_OPTIONS, (status) => {
    onRecorderStatus.current(status);
  });
  const recorderState = useAudioRecorderState(recorder, 250);
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState<AudioNote | null>(null);
  const [reachedLimit, setReachedLimit] = useState(false);
  const [permission, setPermission] = useState<MicPermission>(null);
  const [error, setError] = useState<string | null>(null);
  // Los refs frenan dobles toques y carreras entre el corte nativo, el timer y el botón.
  const active = useRef(false);
  const starting = useRef(false);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Cambiar la fuente crea un player nuevo y suelta el anterior; al desmontar se suelta solo.
  const player = useAudioPlayer(note ? { uri: note.uri } : null);
  const playerStatus = useAudioPlayerStatus(player);

  const finish = useCallback(
    async (reason: StopReason) => {
      if (!active.current) return;
      active.current = false;
      clearTimeout(limitTimer.current);
      // Si ya la cortó el sistema (`forDuration`), `isRecording` es false y no hay largo que medir.
      const { isRecording, durationMillis } = recorder.getStatus();
      try {
        await recorder.stop();
      } catch {
        // Ya estaba frenada.
      }
      stopRecordingMode();
      setRecording(false);
      const uri = recorder.uri;
      if (reason === "error" || !uri) {
        setError(RECORD_ERROR);
      } else if (isRecording && durationMillis < AUDIO_MIN_MILLIS) {
        setError(TOO_SHORT_ERROR);
      } else {
        setNote({ uri });
        setReachedLimit(reason === "limit");
      }
    },
    [recorder],
  );

  useEffect(() => {
    onRecorderStatus.current = (status) => {
      // `forDuration` corta del lado nativo y avisa acá.
      if (status.hasError) void finish("error");
      else if (status.isFinished) void finish("limit");
    };
  }, [finish]);

  const record = useCallback(async () => {
    if (active.current || starting.current) return;
    starting.current = true;
    player.pause();
    setError(null);
    try {
      const response = await requestRecordingPermissionsAsync();
      if (!response.granted) {
        setPermission(response.canAskAgain ? "denied" : "blocked");
        return;
      }
      setPermission(null);
      // iOS no graba sin `allowsRecording`.
      await setRecordingMode(true);
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: AUDIO_MAX_SECONDS });
      active.current = true;
      setNote(null);
      setReachedLimit(false);
      setRecording(true);
      // Respaldo del corte nativo: si el aviso no llega, se corta igual a los 60 s.
      limitTimer.current = setTimeout(() => void finish("limit"), AUDIO_MAX_SECONDS * 1000);
    } catch {
      setError(RECORD_ERROR);
      stopRecordingMode();
    } finally {
      starting.current = false;
    }
  }, [finish, player, recorder]);

  // Si la app pasa a segundo plano, se corta y queda lo grabado. En iOS `inactive` llega antes que
  // `background`, cuando JS todavía corre.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") return;
      void finish("user");
      player.pause();
    });
    return () => subscription.remove();
  }, [finish, player]);

  // Al salir de la pantalla mientras graba, se corta y se descarta.
  useEffect(
    () => () => {
      clearTimeout(limitTimer.current);
      if (!active.current) return;
      active.current = false;
      try {
        recorder.stop().catch(() => {});
      } catch {
        // El grabador ya se soltó.
      }
      stopRecordingMode();
    },
    [recorder],
  );

  const stopPlayback = useCallback(() => player.pause(), [player]);

  const togglePlayback = useCallback(async () => {
    if (playerStatus.playing) {
      player.pause();
      return;
    }
    const atEnd = playerStatus.duration > 0 && playerStatus.currentTime >= playerStatus.duration;
    if (playerStatus.didJustFinish || atEnd) await player.seekTo(0);
    player.play();
  }, [player, playerStatus]);

  const discard = useCallback(() => {
    player.pause();
    setNote(null);
    setReachedLimit(false);
    setError(null);
  }, [player]);

  const elapsedSeconds = recording ? recorderState.durationMillis / 1000 : 0;
  return {
    status: recording ? "recording" : note ? "recorded" : "idle",
    note,
    remainingSeconds: Math.max(0, Math.ceil(AUDIO_MAX_SECONDS - elapsedSeconds)),
    reachedLimit,
    permission,
    error,
    playing: note !== null && playerStatus.playing,
    durationSeconds:
      note && playerStatus.isLoaded && playerStatus.duration > 0 ? playerStatus.duration : null,
    record,
    stop: () => finish("user"),
    togglePlayback,
    stopPlayback,
    discard,
  };
}

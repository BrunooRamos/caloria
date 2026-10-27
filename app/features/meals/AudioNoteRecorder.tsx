import { Mic, Pause, Play, RotateCcw, Square, Trash } from "lucide-react-native";
import { useEffect, useRef } from "react";
import { AccessibilityInfo, Linking, StyleSheet, View } from "react-native";
import { Button, Card, FormError, IconButton, Text } from "@/components";
import { spacing } from "@/theme";
import { formatClock } from "./format";
import { AUDIO_MAX_SECONDS } from "./useAudioNote";
import type { UseAudioNote } from "./useAudioNote";

/** Segundos restantes en los que se avisa al lector de pantalla; en el resto, silencio. */
const ANNOUNCE_AT = [30, 10];

export const LIMIT_MESSAGE = `Llegaste al máximo de ${AUDIO_MAX_SECONDS} segundos.`;

export interface AudioNoteRecorderProps {
  audio: UseAudioNote;
  /** Mientras se sube la comida no se puede tocar el audio. */
  disabled: boolean;
}

/** Bloque del audio en la vista previa: sin audio → grabando → grabado. */
export function AudioNoteRecorder({ audio, disabled }: AudioNoteRecorderProps) {
  const { status, remainingSeconds, reachedLimit } = useRemainingAnnouncements(audio);

  return (
    <Card>
      <View style={styles.row}>
        {status === "idle" && (
          <>
            <IconButton
              icon={Mic}
              variant="tinted"
              label={`Grabar audio de hasta ${AUDIO_MAX_SECONDS} segundos`}
              disabled={disabled}
              onPress={() => void audio.record()}
            />
            <View style={styles.texts}>
              <Text variant="bodyStrong">Contá cómo la preparaste</Text>
              <Text variant="small" color="inkMuted">
                Audio opcional, hasta {AUDIO_MAX_SECONDS} s.
              </Text>
            </View>
          </>
        )}

        {status === "recording" && (
          <>
            <IconButton
              icon={Square}
              variant="tinted"
              label="Detener grabación"
              disabled={disabled}
              onPress={() => void audio.stop()}
            />
            <View style={styles.texts}>
              <Text variant="bodyStrong">Grabando…</Text>
              {/* Sin live region: se leería cada segundo. Los avisos van por announce. */}
              <Text
                variant="small"
                color="inkMuted"
                accessibilityLabel={`Quedan ${remainingSeconds} segundos`}
              >
                Quedan {formatClock(remainingSeconds)}
              </Text>
            </View>
          </>
        )}

        {status === "recorded" && (
          <>
            <IconButton
              icon={audio.playing ? Pause : Play}
              variant="tinted"
              label={audio.playing ? "Pausar audio" : "Escuchar audio"}
              disabled={disabled}
              onPress={() => void audio.togglePlayback()}
            />
            <View style={styles.texts}>
              <Text variant="bodyStrong">Audio grabado</Text>
              {audio.durationSeconds !== null && (
                <Text variant="small" color="inkMuted">
                  {formatClock(audio.durationSeconds)}
                </Text>
              )}
            </View>
            <IconButton
              icon={RotateCcw}
              label="Regrabar audio"
              disabled={disabled}
              onPress={() => void audio.record()}
            />
            <IconButton
              icon={Trash}
              label="Descartar audio"
              disabled={disabled}
              onPress={audio.discard}
            />
          </>
        )}
      </View>

      {status === "recorded" && reachedLimit && (
        <Text variant="small" color="inkMuted">
          {LIMIT_MESSAGE}
        </Text>
      )}
      {audio.permission && <MicPermissionNotice blocked={audio.permission === "blocked"} />}
      <FormError message={audio.error} />
    </Card>
  );
}

/** Sin micrófono el audio no se puede grabar, pero la foto se manda igual. */
function MicPermissionNotice({ blocked }: { blocked: boolean }) {
  return (
    <View style={styles.notice} accessibilityLiveRegion="polite">
      <Text variant="small" color="inkMuted">
        {blocked
          ? "Para grabar el audio, activá el micrófono en la configuración del sistema, en los permisos de CalorIA. Igual podés enviar solo la foto."
          : "Sin acceso al micrófono no podemos grabar el audio. Igual podés enviar solo la foto."}
      </Text>
      {blocked && (
        <Button
          variant="ghost"
          title="Abrir configuración"
          onPress={() => void Linking.openSettings()}
        />
      )}
    </View>
  );
}

/** Anuncia los 30 y 10 s restantes y el corte por límite, una vez cada uno. */
function useRemainingAnnouncements(audio: UseAudioNote) {
  const { status, remainingSeconds, reachedLimit } = audio;
  const announced = useRef(new Set<number>());

  useEffect(() => {
    if (status !== "recording") {
      announced.current.clear();
      return;
    }
    // El estado del grabador se consulta cada 250 ms: un umbral se puede saltear, no repetir.
    const due = ANNOUNCE_AT.filter((at) => remainingSeconds <= at && !announced.current.has(at));
    if (due.length === 0) return;
    for (const at of due) announced.current.add(at);
    AccessibilityInfo.announceForAccessibility(`Quedan ${Math.min(...due)} segundos`);
  }, [status, remainingSeconds]);

  useEffect(() => {
    if (status === "recorded" && reachedLimit) {
      AccessibilityInfo.announceForAccessibility(`Grabación terminada. ${LIMIT_MESSAGE}`);
    }
  }, [status, reachedLimit]);

  return { status, remainingSeconds, reachedLimit };
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  texts: { flex: 1, gap: spacing.xxs },
  notice: { gap: spacing.xs },
});

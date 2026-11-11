import { router } from "expo-router";
import { CalendarClock, X } from "lucide-react-native";
import { useRef, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { Button, FormError, HeaderButton, Notice, Screen, Text } from "@/components";
import { ApiError } from "@/services/api-error";
import { errorMessage } from "@/services/error-messages";
import type { ErrorMessageOverrides } from "@/services/error-messages";
import { createMeal } from "@/services/meals";
import { colors, radius, spacing } from "@/theme";
import { AudioNoteRecorder } from "./AudioNoteRecorder";
import { buildMealForm } from "./meal-form";
import { exceedsMaxBytes } from "./prepare-photo";
import type { PreparedPhoto } from "./prepare-photo";
import type { UseAudioNote } from "./useAudioNote";

export const TOO_LARGE_MESSAGE = "Esta foto pesa más de 8 MB incluso comprimida. Probá con otra.";

const UPLOAD_ERRORS: ErrorMessageOverrides = {
  VALIDATION_ERROR: "No pudimos leer esta foto. Probá con otra.",
  PAYLOAD_TOO_LARGE: "La foto pesa demasiado. Probá con otra.",
};

// Con audio, el 400 o el 413 pueden venir por cualquiera de los dos (por ejemplo, la duración).
const UPLOAD_ERRORS_WITH_AUDIO: ErrorMessageOverrides = {
  VALIDATION_ERROR:
    "No pudimos leer la foto o el audio. Probá regrabar el audio o enviá solo la foto.",
  PAYLOAD_TOO_LARGE:
    "La foto o el audio pesan demasiado. Probá regrabar el audio o enviá solo la foto.",
};

export interface PreviewStepProps {
  photo: PreparedPhoto;
  /** Vive en la captura, así "Sacar otra" no pierde el audio. */
  audio: UseAudioNote;
  /** Mientras sube, la captura no deja salir (ni con el atrás de Android ni con el gesto de iOS). */
  onSendingChange(sending: boolean): void;
  onSent(mealId: string, photoUri: string): void;
  onRetake(): void;
  onClose(): void;
}

export function PreviewStep({
  photo,
  audio,
  onSendingChange,
  onSent,
  onRetake,
  onClose,
}: PreviewStepProps) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  // El estado tarda un render en deshabilitar el botón: el ref frena un segundo toque inmediato.
  const inFlight = useRef(false);
  const tooLarge = exceedsMaxBytes(photo);
  const recording = audio.status === "recording";
  const withAudio = audio.note !== null;

  async function send() {
    if (inFlight.current || tooLarge || recording) return;
    inFlight.current = true;
    audio.stopPlayback();
    setSending(true);
    onSendingChange(true);
    setError(null);
    setQuotaExceeded(false);
    try {
      const { mealId } = await createMeal(
        buildMealForm({ photo, ...(audio.note && { audio: audio.note }) }),
      );
      onSent(mealId, photo.uri);
    } catch (err) {
      // La foto queda en pantalla para reintentar sin sacarla de nuevo.
      inFlight.current = false;
      setSending(false);
      onSendingChange(false);
      if (err instanceof ApiError && err.code === "MEAL_QUOTA_EXCEEDED") setQuotaExceeded(true);
      else setError(errorMessage(err, withAudio ? UPLOAD_ERRORS_WITH_AUDIO : UPLOAD_ERRORS));
    }
  }

  return (
    <Screen>
      <View style={styles.content}>
        <View style={styles.close}>
          <HeaderButton icon={X} title="Cerrar" disabled={sending} onPress={onClose} />
        </View>
        <Text variant="h1" accessibilityRole="header">
          ¿Analizamos esta foto?
        </Text>
        <Image
          source={{ uri: photo.uri }}
          resizeMode="cover"
          accessibilityLabel="Foto de tu comida"
          style={styles.photo}
        />
        <AudioNoteRecorder audio={audio} disabled={sending} />
        {quotaExceeded ? (
          <QuotaExceeded />
        ) : (
          <FormError message={tooLarge ? TOO_LARGE_MESSAGE : error} />
        )}
      </View>
      <View style={styles.actions}>
        {sending && (
          <Text
            variant="small"
            color="inkMuted"
            accessibilityLiveRegion="polite"
            style={styles.centered}
          >
            {withAudio ? "Subiendo foto y audio…" : "Subiendo foto…"}
          </Text>
        )}
        <Button
          title={error ? "Reintentar" : "Enviar"}
          loading={sending}
          disabled={tooLarge || recording}
          onPress={send}
        />
        <Button
          variant="secondary"
          title="Sacar otra"
          disabled={sending || recording}
          onPress={onRetake}
        />
      </View>
    </Screen>
  );
}

/** Sin análisis en el mes: se dice con calma, sin rojo, y se puede ver qué incluye cada plan. */
function QuotaExceeded() {
  return (
    <Notice
      icon={CalendarClock}
      title="Usaste los análisis de este mes"
      detail="Se renuevan el 1.° del mes que viene. En Tu plan ves cuántos tenés y qué incluye cada plan."
    >
      <Button variant="secondary" title="Ver planes" onPress={() => router.push("/plan")} />
    </Notice>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, gap: spacing.md, paddingBottom: spacing.xl },
  // A la misma altura que "Cerrar" en la cámara.
  close: { marginTop: spacing.xs - spacing.xl },
  photo: { flex: 1, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt },
  actions: { gap: spacing.sm },
  centered: { textAlign: "center" },
});

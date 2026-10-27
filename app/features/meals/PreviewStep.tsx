import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Image, StyleSheet, View } from "react-native";
import { Button, FormError, IconButton, Screen, Text } from "@/components";
import { errorMessage } from "@/services/error-messages";
import type { ErrorMessageOverrides } from "@/services/error-messages";
import { createMeal } from "@/services/meals";
import { colors, radius, sizes, spacing } from "@/theme";
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
  onRetake(): void;
  onClose(): void;
}

export function PreviewStep({ photo, audio, onRetake, onClose }: PreviewStepProps) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El estado tarda un render en deshabilitar el botón: el ref frena un segundo toque inmediato.
  const inFlight = useRef(false);
  const tooLarge = exceedsMaxBytes(photo);
  const recording = audio.status === "recording";
  const withAudio = audio.note !== null;

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => inFlight.current);
    return () => subscription.remove();
  }, []);

  async function send() {
    if (inFlight.current || tooLarge || recording) return;
    inFlight.current = true;
    audio.stopPlayback();
    setSending(true);
    setError(null);
    try {
      const { mealId } = await createMeal(
        buildMealForm({ photo, ...(audio.note && { audio: audio.note }) }),
      );
      // Reemplaza la captura: volver atrás desde el resultado lleva a la home, no a la cámara.
      router.replace({ pathname: "/meals/[id]", params: { id: mealId, photoUri: photo.uri } });
    } catch (err) {
      // La foto queda en pantalla para reintentar sin sacarla de nuevo.
      inFlight.current = false;
      setSending(false);
      setError(errorMessage(err, withAudio ? UPLOAD_ERRORS_WITH_AUDIO : UPLOAD_ERRORS));
    }
  }

  return (
    <Screen>
      <View style={styles.content}>
        <View style={styles.back}>
          <IconButton
            icon={ChevronLeft}
            label="Volver al inicio"
            disabled={sending}
            onPress={onClose}
          />
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
        <FormError message={tooLarge ? TOO_LARGE_MESSAGE : error} />
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

const styles = StyleSheet.create({
  content: { flex: 1, gap: spacing.md, paddingBottom: spacing.xl },
  back: { alignSelf: "flex-start", marginLeft: -(sizes.touchTarget - sizes.icon) / 2 },
  photo: { flex: 1, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt },
  actions: { gap: spacing.sm },
  centered: { textAlign: "center" },
});

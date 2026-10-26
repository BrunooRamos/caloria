import { router } from "expo-router";
import { useRef, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { Button, FormError, Screen, Text } from "@/components";
import { errorMessage } from "@/services/error-messages";
import type { ErrorMessageOverrides } from "@/services/error-messages";
import { createMeal } from "@/services/meals";
import { colors, radius, spacing } from "@/theme";
import { buildMealForm } from "./meal-form";
import { exceedsMaxBytes } from "./prepare-photo";
import type { PreparedPhoto } from "./prepare-photo";

export const TOO_LARGE_MESSAGE = "Esta foto pesa más de 8 MB incluso comprimida. Probá con otra.";

const UPLOAD_ERRORS: ErrorMessageOverrides = {
  VALIDATION_ERROR: "No pudimos leer esta foto. Probá con otra.",
  PAYLOAD_TOO_LARGE: "La foto pesa demasiado. Probá con otra.",
};

export interface PreviewStepProps {
  photo: PreparedPhoto;
  onRetake(): void;
}

export function PreviewStep({ photo, onRetake }: PreviewStepProps) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El estado tarda un render en deshabilitar el botón: el ref frena un segundo toque inmediato.
  const inFlight = useRef(false);
  const tooLarge = exceedsMaxBytes(photo);

  async function send() {
    if (inFlight.current || tooLarge) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      const { mealId } = await createMeal(buildMealForm({ photo }));
      // Reemplaza la captura: volver atrás desde el resultado lleva a la home, no a la cámara.
      router.replace({ pathname: "/meals/[id]", params: { id: mealId, photoUri: photo.uri } });
    } catch (err) {
      // La foto queda en pantalla para reintentar sin sacarla de nuevo.
      inFlight.current = false;
      setSending(false);
      setError(errorMessage(err, UPLOAD_ERRORS));
    }
  }

  return (
    <Screen>
      <View style={styles.content}>
        <Text variant="h1" accessibilityRole="header">
          ¿Analizamos esta foto?
        </Text>
        <Image
          source={{ uri: photo.uri }}
          resizeMode="cover"
          accessibilityLabel="Foto de tu comida"
          style={styles.photo}
        />
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
            Subiendo foto…
          </Text>
        )}
        <Button
          title={error ? "Reintentar" : "Enviar"}
          loading={sending}
          disabled={tooLarge}
          onPress={send}
        />
        <Button variant="secondary" title="Sacar otra" disabled={sending} onPress={onRetake} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, gap: spacing.md, paddingBottom: spacing.xl },
  photo: { flex: 1, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt },
  actions: { gap: spacing.sm },
  centered: { textAlign: "center" },
});

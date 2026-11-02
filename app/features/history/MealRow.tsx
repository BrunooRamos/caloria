import { Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { Button, FormError, IconButton, Text } from "@/components";
import { errorMessage } from "@/services/error-messages";
import type { Meal } from "@/services/meals";
import { borderWidth, colors, opacity, radius, spacing } from "@/theme";
import { mealSummary } from "./format";

export const MEAL_THUMBNAIL = 56;

export interface MealRowProps {
  meal: Meal;
  /** Hora ya formateada en la zona del usuario. */
  time: string;
  onOpen(): void;
  onDelete(): Promise<void>;
}

/**
 * Una comida del día: tocarla abre el detalle. Borrar pide confirmación en la misma fila, como
 * cerrar sesión en el perfil.
 */
export function MealRow({ meal, time, onOpen, onDelete }: MealRowProps) {
  const { title, detail } = mealSummary(meal);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [photoFailed, setPhotoFailed] = useState(false);

  async function confirmDelete() {
    setDeleting(true);
    setError(null);
    try {
      // Si sale bien, la fila desaparece de la lista.
      await onDelete();
    } catch (err) {
      setError(err);
      setDeleting(false);
    }
  }

  function cancel() {
    setConfirming(false);
    setError(null);
  }

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${time}, ${title}, ${detail}`}
          accessibilityHint="Abre el detalle de la comida"
          onPress={onOpen}
          style={({ pressed }) => [styles.main, pressed && styles.pressed]}
        >
          {meal.photoUrl && !photoFailed ? (
            <Image
              source={{ uri: meal.photoUrl }}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
              onError={() => setPhotoFailed(true)}
              style={styles.thumbnail}
            />
          ) : (
            <View style={styles.thumbnail} />
          )}
          <View style={styles.text}>
            <Text variant="caption" color="inkMuted">
              {time}
            </Text>
            <Text variant="bodyStrong" numberOfLines={2}>
              {title}
            </Text>
            <Text variant="small" color="inkMuted">
              {detail}
            </Text>
          </View>
        </Pressable>
        <IconButton
          icon={Trash2}
          label={`Eliminar la comida de las ${time}`}
          disabled={confirming}
          onPress={() => setConfirming(true)}
        />
      </View>

      {confirming && (
        <View style={styles.confirm} accessibilityLiveRegion="polite">
          <Text variant="bodyStrong" accessibilityRole="header">
            ¿Eliminar esta comida?
          </Text>
          <Text variant="small" color="inkMuted">
            Se borra con su foto y deja de sumar en el día. No se puede deshacer.
          </Text>
          {error !== null && (
            <FormError message={errorMessage(error, { NOT_FOUND: "Esta comida ya no existe." })} />
          )}
          <View style={styles.actions}>
            <Button
              variant="secondary"
              title="Sí, eliminar"
              loading={deleting}
              onPress={confirmDelete}
            />
            <Button variant="ghost" title="Cancelar" disabled={deleting} onPress={cancel} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: borderWidth.default,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  main: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  pressed: { opacity: opacity.pressed },
  thumbnail: {
    width: MEAL_THUMBNAIL,
    height: MEAL_THUMBNAIL,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  text: { flex: 1, gap: spacing.xxs },
  confirm: {
    gap: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  actions: { gap: spacing.xs },
});

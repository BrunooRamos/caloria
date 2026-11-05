import { ChevronRight, ImageOff } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";
import { Skeleton, Text } from "@/components";
import type { Meal } from "@/services/meals";
import { borderWidth, colors, opacity, radius, sizes, spacing, typography } from "@/theme";
import { mealSummary } from "./format";

export const MEAL_THUMBNAIL = 56;

export interface MealRowProps {
  meal: Meal;
  /** Hora ya formateada en la zona del usuario. */
  time: string;
  onOpen(): void;
}

/**
 * Una comida del día, en el inicio y en el historial: tocarla abre el detalle. La que se está
 * analizando va sobre `surfaceAlt` con un indicador en lugar de la flecha; la que no se pudo
 * analizar, con el texto en `warning` y su ícono. Nunca solo por color.
 */
export function MealRow({ meal, time, onOpen }: MealRowProps) {
  const { title, detail } = mealSummary(meal);
  const [photoFailed, setPhotoFailed] = useState(false);
  const analyzing = meal.status === "processing";
  const failed = meal.status === "failed";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${time}, ${title}, ${detail}`}
      accessibilityHint="Abre el detalle de la comida"
      accessibilityState={{ busy: analyzing }}
      onPress={onOpen}
      style={({ pressed }) => [
        styles.card,
        analyzing && styles.analyzing,
        pressed && styles.pressed,
      ]}
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
        <Text variant="bodyStrong" color={failed ? "warning" : "ink"} numberOfLines={2}>
          {title}
        </Text>
        <Text variant="small" color="inkMuted">
          {detail}
        </Text>
      </View>
      {analyzing ? (
        <ActivityIndicator color={colors.primary} />
      ) : failed ? (
        <ImageOff color={colors.warning} size={sizes.iconDense} strokeWidth={sizes.iconStroke} />
      ) : (
        <ChevronRight
          color={colors.inkMuted}
          size={sizes.iconDense}
          strokeWidth={sizes.iconStroke}
        />
      )}
    </Pressable>
  );
}

/** La forma de la lista mientras carga: filas con foto, hora, plato y kcal. */
export function MealListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <View
      accessible
      accessibilityLabel="Cargando las comidas"
      accessibilityState={{ busy: true }}
      style={styles.skeleton}
    >
      {Array.from({ length: rows }, (_, key) => (
        <View key={key} style={[styles.card, styles.skeletonRow]}>
          <Skeleton height={MEAL_THUMBNAIL} width={MEAL_THUMBNAIL} rounded="md" />
          <View style={styles.text}>
            <Skeleton height={typography.caption.lineHeight} width="20%" />
            <Skeleton height={typography.bodyStrong.lineHeight} width="70%" />
            <Skeleton height={typography.small.lineHeight} width="40%" />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: borderWidth.default,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.sm,
  },
  analyzing: { backgroundColor: colors.surfaceAlt },
  pressed: { opacity: opacity.pressed },
  thumbnail: {
    width: MEAL_THUMBNAIL,
    height: MEAL_THUMBNAIL,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  text: { flex: 1, gap: spacing.xxs },
  skeleton: { gap: spacing.sm },
  skeletonRow: { borderWidth: 0 },
});

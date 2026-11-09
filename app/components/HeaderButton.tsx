import type { LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet } from "react-native";
import type { PressableProps } from "react-native";
import { colors, opacity, radius, sizes, spacing } from "@/theme";
import { Text } from "./Text";

/** `camera`: sobre la cámara, con fondo oscuro translúcido y texto blanco. */
export type HeaderButtonVariant = "default" | "camera";

export interface HeaderButtonProps extends Omit<PressableProps, "children" | "style"> {
  icon: LucideIcon;
  title: string;
  variant?: HeaderButtonVariant;
}

/**
 * Ícono con texto arriba a la izquierda: "Volver" en el header de las pantallas de detalle y
 * "Cerrar" en la cámara. Siempre lleva texto y mide al menos 44 de alto.
 */
export function HeaderButton({
  icon: Icon,
  title,
  variant = "default",
  disabled,
  ...props
}: HeaderButtonProps) {
  const color = variant === "camera" ? colors.onCamera : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: Boolean(disabled) }}
      {...props}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        variant === "camera" && styles.camera,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Icon color={color} size={sizes.icon} strokeWidth={sizes.iconStroke} />
      <Text
        variant="label"
        color={variant === "camera" ? "onCamera" : "primary"}
        maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}
      >
        {title}
      </Text>
    </Pressable>
  );
}

/** El header no crece más que los títulos (skill §2): con la fuente al máximo, el contenido sí. */
export const HEADER_MAX_FONT_SCALE = 1.3;

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    minHeight: sizes.touchTarget,
    paddingLeft: spacing.xs,
    paddingRight: spacing.sm,
    borderRadius: radius.full,
    alignSelf: "flex-start",
  },
  camera: { backgroundColor: colors.cameraControl },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
});

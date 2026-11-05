import type { LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import type { PressableProps } from "react-native";
import { colors, opacity, radius, sizes, spacing } from "@/theme";
import { Text } from "./Text";

/** `tinted`: fondo `sageSoft`, para la acción principal de un bloque. */
export type IconButtonVariant = "default" | "camera" | "tinted";

export interface IconButtonProps extends Omit<PressableProps, "children" | "style"> {
  icon: LucideIcon;
  label: string;
  variant?: IconButtonVariant;
  caption?: string;
}

export function IconButton({
  icon: Icon,
  label,
  variant = "default",
  caption,
  disabled,
  ...props
}: IconButtonProps) {
  const icon = (
    <Icon
      color={variant === "camera" ? colors.onCamera : colors.primary}
      size={sizes.icon}
      strokeWidth={sizes.iconStroke}
    />
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      {...props}
      disabled={disabled}
      style={({ pressed }) => [
        caption ? styles.captioned : [styles.base, styles[variant]],
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {caption ? (
        <>
          <View style={[styles.base, styles[variant]]}>{icon}</View>
          <Text variant="caption" color={variant === "camera" ? "onCamera" : "primary"}>
            {caption}
          </Text>
        </>
      ) : (
        icon
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  captioned: { alignItems: "center", gap: spacing.xxs, minWidth: sizes.touchTarget },
  default: {},
  camera: { backgroundColor: colors.cameraControl },
  tinted: { backgroundColor: colors.sageSoft },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
});

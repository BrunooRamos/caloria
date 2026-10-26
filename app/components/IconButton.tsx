import type { LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet } from "react-native";
import type { PressableProps } from "react-native";
import { colors, opacity, radius, sizes } from "@/theme";

export type IconButtonVariant = "default" | "camera";

export interface IconButtonProps extends Omit<PressableProps, "children" | "style"> {
  icon: LucideIcon;
  label: string;
  variant?: IconButtonVariant;
}

export function IconButton({
  icon: Icon,
  label,
  variant = "default",
  disabled,
  ...props
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      {...props}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Icon
        color={variant === "camera" ? colors.onCamera : colors.primary}
        size={sizes.icon}
        strokeWidth={sizes.iconStroke}
      />
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
  default: {},
  camera: { backgroundColor: colors.cameraControl },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
});

import type { LucideIcon } from "lucide-react-native";
import { ActivityIndicator, Pressable, StyleSheet } from "react-native";
import type { PressableProps } from "react-native";
import { colors, opacity, radius, sizes, spacing } from "@/theme";
import type { ColorToken } from "@/theme";
import { Text } from "./Text";
import { useTone } from "./tone";
import type { SurfaceTone } from "./tone";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: LucideIcon;
}

const textColors: Record<SurfaceTone, Record<ButtonVariant, ColorToken>> = {
  default: { primary: "onPrimary", secondary: "primary", ghost: "primary" },
  brand: { primary: "primary", secondary: "primary", ghost: "cream" },
};

export function Button({
  title,
  variant = "primary",
  loading = false,
  disabled = false,
  icon: Icon,
  ...props
}: ButtonProps) {
  const tone = useTone();
  const textColor = textColors[tone][variant];
  const inverted = tone === "brand" && variant === "primary";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: Boolean(disabled), busy: loading }}
      {...props}
      disabled={Boolean(disabled) || loading}
      style={({ pressed }) => [
        styles.base,
        inverted ? styles.primaryOnBrand : styles[variant],
        pressed && (variant === "primary" && !inverted ? styles.pressedPrimary : styles.pressed),
        disabled && styles.disabled,
      ]}
    >
      {Icon && (
        <Icon
          color={colors[textColor]}
          size={sizes.icon}
          strokeWidth={sizes.iconStroke}
          style={loading && styles.hidden}
        />
      )}
      <Text variant="label" color={textColor} style={[styles.text, loading && styles.hidden]}>
        {title}
      </Text>
      {loading && <ActivityIndicator color={colors[textColor]} style={StyleSheet.absoluteFill} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: sizes.control,
    borderRadius: radius.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xs,
    flexDirection: "row",
    gap: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: { backgroundColor: colors.primary },
  primaryOnBrand: { backgroundColor: colors.cream },
  secondary: { backgroundColor: colors.sageSoft },
  ghost: {},
  pressedPrimary: { backgroundColor: colors.primaryPressed },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
  text: { flexShrink: 1, textAlign: "center" },
  hidden: { opacity: 0 },
});

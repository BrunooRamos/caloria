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
      <Text variant="label" color={textColor} style={loading && styles.hidden}>
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
  hidden: { opacity: 0 },
});

import { Pressable, StyleSheet } from "react-native";
import type { PressableProps } from "react-native";
import { opacity, sizes, spacing, typography } from "@/theme";
import { Text } from "./Text";

export interface TextButtonProps extends Omit<PressableProps, "children" | "style" | "hitSlop"> {
  title: string;
}

// Lleva el target táctil a 44 aunque el texto mida 20 de alto.
const hitSlop = {
  vertical: (sizes.touchTarget - typography.small.lineHeight) / 2,
  horizontal: spacing.xs,
};

/** Acción chica dentro de un bloque, como "Rango" junto al label de un campo o "Deshacer". */
export function TextButton({ title, disabled, ...props }: TextButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: Boolean(disabled) }}
      hitSlop={{
        top: hitSlop.vertical,
        bottom: hitSlop.vertical,
        left: hitSlop.horizontal,
        right: hitSlop.horizontal,
      }}
      {...props}
      disabled={disabled}
      style={({ pressed }) => [pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text variant="smallStrong" color="primary">
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
});

import type { LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet } from "react-native";
import type { PressableProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, opacity, radius, shadow, sizes, spacing } from "@/theme";

export interface FabProps extends Omit<PressableProps, "children" | "style"> {
  icon: LucideIcon;
  label: string;
}

/** Botón flotante abajo a la derecha, por encima del contenido y de la safe area. */
export function Fab({ icon: Icon, label, disabled, ...props }: FabProps) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...props}
      disabled={disabled}
      style={({ pressed }) => [
        styles.fab,
        { bottom: insets.bottom + spacing.xl, right: insets.right + spacing.lg },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Icon color={colors.onPrimary} size={sizes.icon} strokeWidth={sizes.iconStroke} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    width: sizes.fab,
    height: sizes.fab,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.float,
  },
  pressed: { backgroundColor: colors.primaryPressed },
  disabled: { opacity: opacity.disabled },
});

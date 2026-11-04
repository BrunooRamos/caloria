import { Pressable, StyleSheet, Switch, View } from "react-native";
import { colors, opacity, sizes, spacing } from "@/theme";
import { Text } from "./Text";

export interface SwitchRowProps {
  label: string;
  description?: string;
  value: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
}

/** Toda la fila es el interruptor: el `Switch` nativo queda solo como indicador. */
export function SwitchRow({
  label,
  description,
  value,
  onChange,
  disabled = false,
}: SwitchRowProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View style={styles.texts}>
        <Text variant="bodyStrong">{label}</Text>
        {description ? (
          <Text variant="small" color="inkMuted">
            {description}
          </Text>
        ) : null}
      </View>
      <View
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <Switch
          value={value}
          disabled={disabled}
          trackColor={{ false: colors.borderStrong, true: colors.primary }}
          thumbColor={colors.surface}
          ios_backgroundColor={colors.borderStrong}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: sizes.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
  texts: { flex: 1, gap: spacing.xxs },
});

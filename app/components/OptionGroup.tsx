import { Pressable, StyleSheet, View } from "react-native";
import { borderWidth, colors, opacity, radius, sizes, spacing } from "@/theme";
import { Text } from "./Text";

export interface OptionGroupOption {
  value: string;
  label: string;
  description?: string;
}

export interface OptionGroupProps {
  label: string;
  options: readonly OptionGroupOption[];
  value: string;
  onChange(value: string): void;
  error?: string | null;
  hint?: string;
  disabled?: boolean;
}

export function OptionGroup({
  label,
  options,
  value,
  onChange,
  error,
  hint,
  disabled = false,
}: OptionGroupProps) {
  const invalid = Boolean(error);
  const message = error || hint;

  return (
    <View style={styles.field}>
      <Text variant="smallStrong">{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.options}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityHint={option.description}
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.option,
                selected && styles.selected,
                invalid && !selected && styles.error,
                pressed && styles.pressed,
                disabled && styles.disabled,
              ]}
            >
              <View style={[styles.radio, selected && styles.radioSelected]}>
                {selected && <View style={styles.dot} />}
              </View>
              <View style={styles.texts}>
                <Text variant="bodyStrong" color={selected ? "primary" : "ink"}>
                  {option.label}
                </Text>
                {option.description ? (
                  <Text variant="small" color="inkMuted">
                    {option.description}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      {message ? (
        <Text
          variant="small"
          color={invalid ? "danger" : "inkMuted"}
          accessibilityLiveRegion={invalid ? "polite" : "none"}
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const RADIO = sizes.iconDense;
const DOT = RADIO / 2;
const inset = (border: number) => ({
  paddingHorizontal: spacing.md - (border - borderWidth.default),
  paddingVertical: spacing.sm - (border - borderWidth.default),
});

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  options: { gap: spacing.xs },
  option: {
    minHeight: sizes.control,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: borderWidth.default,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    ...inset(borderWidth.default),
  },
  selected: {
    backgroundColor: colors.sageSoft,
    borderWidth: borderWidth.focus,
    borderColor: colors.primary,
    ...inset(borderWidth.focus),
  },
  error: {
    borderWidth: borderWidth.error,
    borderColor: colors.danger,
    ...inset(borderWidth.error),
  },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
  radio: {
    width: RADIO,
    height: RADIO,
    borderRadius: radius.full,
    borderWidth: borderWidth.focus,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: colors.primary },
  dot: { width: DOT, height: DOT, borderRadius: radius.full, backgroundColor: colors.primary },
  texts: { flex: 1, gap: spacing.xxs },
});

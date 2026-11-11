import { Platform, StyleSheet, View } from "react-native";
import { Input, TextButton } from "@/components";
import { spacing } from "@/theme";
import { RANGE_TEXT_MAX_CHARS } from "./parse-range";

export interface RangeFieldProps {
  label: string;
  /** Para el lector de pantalla, cuando el label solo no alcanza: "Gramos de Milanesa". */
  accessibilityLabel?: string;
  value: string;
  placeholder: string;
  error?: string;
  hint?: string;
  /** Acción debajo del campo, como volver a la suma. */
  action?: { title: string; onPress(): void };
  editable: boolean;
  onChangeText(text: string): void;
  onBlur(): void;
}

const KEYBOARD = Platform.select({ ios: "numbers-and-punctuation", default: "numeric" } as const);

export function RangeField({
  label,
  accessibilityLabel = label,
  value,
  placeholder,
  error,
  hint,
  action,
  editable,
  onChangeText,
  onBlur,
}: RangeFieldProps) {
  return (
    <View style={styles.field}>
      <Input
        label={label}
        accessibilityLabel={accessibilityLabel}
        value={value}
        placeholder={placeholder}
        keyboardType={KEYBOARD}
        autoCorrect={false}
        autoComplete="off"
        maxLength={RANGE_TEXT_MAX_CHARS}
        editable={editable}
        error={error}
        hint={hint}
        onChangeText={onChangeText}
        onBlur={onBlur}
      />
      {action ? (
        <View style={styles.action}>
          <TextButton title={action.title} disabled={!editable} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  action: { alignItems: "flex-start" },
});

import { StyleSheet, View } from "react-native";
import { Input, Text, TextButton } from "@/components";
import type { Range } from "@/services/meals";
import { sizes, spacing } from "@/theme";
import { formatRange } from "../format";
import type { RangeDraft, RangeInput } from "./draft";
import { VALUE_MAX_DIGITS } from "./validation";

export interface RangeFieldProps {
  label: string;
  unit: string;
  /** Para el lector de pantalla, cuando el label solo no alcanza: "Gramos de Milanesa". */
  accessibilityLabel?: string;
  draft: RangeDraft;
  /** Lo que queda si el campo está vacío: se muestra como placeholder. */
  current?: Range;
  errors: Partial<Record<RangeInput, string>>;
  /** Debajo del campo, como "Suma de los ingredientes." */
  hint?: string;
  /** Acción debajo del campo, como volver a la suma. */
  action?: { title: string; onPress(): void };
  editable: boolean;
  onChange(next: RangeDraft): void;
  onToggle(): void;
  onBlur(): void;
}

/**
 * Un valor `{ min, max }` escrito como un solo número, o como mínimo y máximo para quien lo quiera.
 * Vacío deja lo que había (`current`), que se ve como placeholder.
 */
export function RangeField({
  label,
  unit,
  accessibilityLabel = label,
  draft,
  current,
  errors,
  hint,
  action,
  editable,
  onChange,
  onToggle,
  onBlur,
}: RangeFieldProps) {
  const single = draft.mode === "single";
  const numeric = {
    keyboardType: "number-pad",
    inputMode: "numeric",
    maxLength: VALUE_MAX_DIGITS,
    editable,
    onBlur,
    hideLabel: true,
  } as const;

  return (
    <View style={styles.field}>
      <View style={styles.header}>
        <Text variant="smallStrong" style={styles.label}>
          {label}
        </Text>
        <TextButton
          title={single ? "Rango" : "Un valor"}
          accessibilityLabel={
            single
              ? `${accessibilityLabel}: usar mínimo y máximo`
              : `${accessibilityLabel}: usar un solo valor`
          }
          disabled={!editable}
          onPress={onToggle}
        />
      </View>

      {single ? (
        <Input
          {...numeric}
          label={accessibilityLabel}
          value={draft.value}
          placeholder={current ? formatRange(current, unit) : undefined}
          accessibilityHint={
            errors.value ?? (current ? `Vacío queda ${formatRange(current, unit)}.` : undefined)
          }
          error={errors.value}
          onChangeText={(value) => onChange({ ...draft, value })}
        />
      ) : (
        <View style={styles.range}>
          <View style={styles.end}>
            <Input
              {...numeric}
              label={`${accessibilityLabel}, mínimo`}
              placeholder="Mín."
              value={draft.min}
              error={errors.min}
              onChangeText={(min) => onChange({ ...draft, min })}
            />
          </View>
          <Text color="inkMuted" style={styles.dash}>
            –
          </Text>
          <View style={styles.end}>
            <Input
              {...numeric}
              label={`${accessibilityLabel}, máximo`}
              placeholder="Máx."
              value={draft.max}
              error={errors.max}
              onChangeText={(max) => onChange({ ...draft, max })}
            />
          </View>
        </View>
      )}

      {hint ? (
        <Text variant="small" color="inkMuted">
          {hint}
        </Text>
      ) : null}
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
  header: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  label: { flex: 1 },
  range: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs },
  end: { flex: 1 },
  dash: { lineHeight: sizes.control },
  action: { alignItems: "flex-start" },
});

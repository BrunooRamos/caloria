import DateTimePicker from "@react-native-community/datetimepicker";
import { CalendarDays } from "lucide-react-native";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { borderWidth, colors, opacity, radius, sizes, spacing } from "@/theme";
import { Button } from "./Button";
import { Text } from "./Text";

export interface DateFieldProps {
  label: string;
  /** `YYYY-MM-DD`, o vacío si todavía no se eligió. */
  value: string;
  onChange(value: string): void;
  onBlur?(): void;
  error?: string | null;
  hint?: string;
  placeholder?: string;
  initialDate: Date;
  minimumDate?: Date;
  maximumDate?: Date;
  disabled?: boolean;
}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function parse(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function format(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "10 de abril de 2002". */
export function formatLongDate(value: string): string {
  const date = parse(value);
  if (!date) return value;
  return `${date.getDate()} de ${MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
}

/** Campo que abre el selector de fecha nativo: diálogo en Android, rueda debajo del campo en iOS. */
export function DateField({
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  placeholder = "Elegí una fecha",
  initialDate,
  minimumDate,
  maximumDate,
  disabled = false,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = parse(value);
  const invalid = Boolean(error);
  const message = error || hint;
  const inline = Platform.OS === "ios";

  function close() {
    setOpen(false);
    onBlur?.();
  }

  function openPicker() {
    if (open && inline) {
      close();
      return;
    }
    // En iOS la rueda arranca en una fecha: si no se mueve, "Listo" elige esa.
    if (inline && !selected) onChange(format(initialDate));
    setOpen(true);
  }

  return (
    <View style={styles.field}>
      <Text variant="smallStrong">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: selected ? formatLongDate(value) : placeholder }}
        accessibilityHint={message || undefined}
        accessibilityState={{ disabled, expanded: inline ? open : undefined }}
        disabled={disabled}
        onPress={openPicker}
        style={({ pressed }) => [
          styles.box,
          open && styles.focused,
          invalid && styles.error,
          pressed && styles.pressed,
          disabled && styles.disabled,
        ]}
      >
        <Text color={selected ? "ink" : "inkMuted"} style={styles.value}>
          {selected ? formatLongDate(value) : placeholder}
        </Text>
        <CalendarDays
          size={sizes.iconDense}
          strokeWidth={sizes.iconStrokeLight}
          color={colors.primary}
        />
      </Pressable>
      {open && (
        <DateTimePicker
          testID={`${label}-picker`}
          mode="date"
          display={inline ? "spinner" : "default"}
          value={selected ?? initialDate}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          locale="es"
          textColor={colors.ink}
          themeVariant="light"
          onValueChange={(_event, date) => {
            onChange(format(date));
            if (!inline) close();
          }}
          onDismiss={close}
        />
      )}
      {open && inline && <Button variant="secondary" title="Listo" onPress={close} />}
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

const padding = (border: number) => spacing.md - (border - borderWidth.default);

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  box: {
    minHeight: sizes.control,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: borderWidth.default,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: padding(borderWidth.default),
  },
  focused: {
    borderWidth: borderWidth.focus,
    borderColor: colors.primary,
    paddingHorizontal: padding(borderWidth.focus),
  },
  error: {
    borderWidth: borderWidth.error,
    borderColor: colors.danger,
    paddingHorizontal: padding(borderWidth.error),
  },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
  value: { flex: 1 },
});

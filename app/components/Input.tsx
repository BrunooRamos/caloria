import { Eye, EyeClosed } from "lucide-react-native";
import { useState } from "react";
import type { Ref } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import type { TextInputInstance, TextInputProps } from "react-native";
import { borderWidth, colors, fonts, opacity, radius, sizes, spacing, typography } from "@/theme";
import type { ColorToken } from "@/theme";
import { Text } from "./Text";
import { useTone } from "./tone";
import type { SurfaceTone } from "./tone";

export interface InputProps extends Omit<TextInputProps, "style" | "placeholderTextColor"> {
  label: string;
  /** Pinta el campo en estado de error y reemplaza a `hint`. */
  error?: string | null;
  /** Ayuda que se ve siempre, debajo del campo. */
  hint?: string;
  /** Con `secureTextEntry`: el placeholder mientras se muestra lo escrito. */
  revealedPlaceholder?: string;
  /** No muestra el label, que sigue llegando al lector de pantalla: lo dibuja quien arma el campo. */
  hideLabel?: boolean;
  ref?: Ref<TextInputInstance>;
}

/** Colores de los textos del campo según el fondo de la pantalla. */
const textColors: Record<SurfaceTone, Record<"label" | "hint" | "error", ColorToken>> = {
  default: { label: "ink", hint: "inkMuted", error: "danger" },
  brand: { label: "cream", hint: "onPrimaryMuted", error: "onPrimaryDanger" },
};

/** Con `secureTextEntry` suma el botón para mostrar u ocultar lo que se escribió. */
export function Input({
  label,
  error,
  hint,
  placeholder,
  revealedPlaceholder,
  hideLabel = false,
  secureTextEntry = false,
  onFocus,
  onBlur,
  ref,
  ...props
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const tone = useTone();
  const onBrand = tone === "brand";
  const invalid = Boolean(error);
  const message = error || hint;

  return (
    <View style={styles.field}>
      {!hideLabel && (
        <Text variant="smallStrong" color={textColors[tone].label}>
          {label}
        </Text>
      )}
      <View
        style={[
          styles.box,
          onBrand && styles.boxOnBrand,
          focused && (onBrand ? styles.focusedOnBrand : styles.focused),
          invalid && styles.error,
        ]}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={message || undefined}
          placeholder={revealed && revealedPlaceholder ? revealedPlaceholder : placeholder}
          placeholderTextColor={colors.inkMuted}
          cursorColor={colors.primary}
          selectionColor={colors.primary}
          {...props}
          secureTextEntry={secureTextEntry && !revealed}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={styles.input}
        />
        {secureTextEntry && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Ocultar contraseña" : "Mostrar contraseña"}
            onPress={() => setRevealed((value) => !value)}
            style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
          >
            {revealed ? (
              <Eye
                size={sizes.iconDense}
                strokeWidth={sizes.iconStrokeLight}
                color={colors.primary}
              />
            ) : (
              <EyeClosed
                size={sizes.iconDense}
                strokeWidth={sizes.iconStrokeLight}
                color={colors.primary}
              />
            )}
          </Pressable>
        )}
      </View>
      {message ? (
        <Text
          variant="small"
          color={textColors[tone][invalid ? "error" : "hint"]}
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
    backgroundColor: colors.surface,
    borderWidth: borderWidth.default,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: padding(borderWidth.default),
  },
  boxOnBrand: { backgroundColor: colors.cream },
  focused: {
    borderWidth: borderWidth.focus,
    borderColor: colors.primary,
    paddingHorizontal: padding(borderWidth.focus),
  },
  focusedOnBrand: {
    borderWidth: borderWidth.focus,
    borderColor: colors.sage,
    paddingHorizontal: padding(borderWidth.focus),
  },
  error: {
    borderWidth: borderWidth.error,
    borderColor: colors.danger,
    paddingHorizontal: padding(borderWidth.error),
  },
  input: {
    flex: 1,
    alignSelf: "stretch",
    ...fonts.regular,
    fontSize: typography.body.fontSize,
    color: colors.ink,
  },
  toggle: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    marginRight: -(sizes.touchTarget - sizes.iconDense) / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: opacity.pressed },
});

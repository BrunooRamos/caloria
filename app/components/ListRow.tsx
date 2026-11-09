import { ChevronRight } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { Children, Fragment } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { borderWidth, colors, opacity, radius, sizes, spacing } from "@/theme";
import { Text } from "./Text";

export interface ListRowProps {
  icon: LucideIcon;
  title: string;
  detail?: string;
  onPress(): void;
}

/**
 * Una fila de un menú estilo configuración: ícono, título, el resumen de lo que hay adentro y la
 * flecha. Tocarla abre la pantalla de esa sección.
 */
export function ListRow({ icon: Icon, title, detail, onPress }: ListRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.icon}>
        <Icon color={colors.primary} size={sizes.iconDense} strokeWidth={sizes.iconStroke} />
      </View>
      <View style={styles.text}>
        <Text variant="bodyStrong">{title}</Text>
        {detail ? (
          <Text variant="small" color="inkMuted">
            {detail}
          </Text>
        ) : null}
      </View>
      <ChevronRight color={colors.inkMuted} size={sizes.iconDense} strokeWidth={sizes.iconStroke} />
    </Pressable>
  );
}

/** Las filas de un menú juntas en una tarjeta, separadas por un divisor. */
export function ListGroup({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <View style={styles.group}>
      {rows.map((row, index) => (
        <Fragment key={index}>
          {index > 0 && <View style={styles.divider} />}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

const ICON_BOX = sizes.iconDense + spacing.md;

const styles = StyleSheet.create({
  group: {
    backgroundColor: colors.surface,
    borderWidth: borderWidth.default,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: sizes.control + spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pressed: { opacity: opacity.pressed },
  icon: {
    width: ICON_BOX,
    height: ICON_BOX,
    borderRadius: radius.full,
    backgroundColor: colors.sageSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1, gap: spacing.xxs },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: spacing.md + ICON_BOX + spacing.sm,
  },
});

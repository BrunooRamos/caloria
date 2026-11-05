import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { colors, sizes, spacing } from "@/theme";
import { Card } from "./Card";
import { Text } from "./Text";

export interface NoticeProps {
  icon?: LucideIcon;
  leading?: ReactNode;
  title: string;
  detail?: string;
  children?: ReactNode;
}

/**
 * Estado vacío, de espera o de error de un bloque: ícono, título, explicación y qué hacer. Tono
 * tranquilo, sin rojo: para la comida nunca es una alarma.
 */
export function Notice({ icon: Icon, leading, title, detail, children }: NoticeProps) {
  return (
    <Card accessibilityLiveRegion="polite">
      {leading ??
        (Icon && <Icon color={colors.inkMuted} size={sizes.icon} strokeWidth={sizes.iconStroke} />)}
      <Text variant="h3" accessibilityRole="header">
        {title}
      </Text>
      {detail ? <Text color="inkMuted">{detail}</Text> : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm, marginTop: spacing.xs },
});

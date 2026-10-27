import { ImageOff, UtensilsCrossed } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Card, Text } from "@/components";
import { colors, sizes, spacing } from "@/theme";
import { mealsCount } from "./format";

/** Comidas en `processing`: el total todavía va a cambiar. */
export function AnalyzingNotice({ count }: { count: number }) {
  return (
    <Notice
      leading={<ActivityIndicator color={colors.primary} accessibilityLabel="Analizando" />}
      title={`${mealsCount(count)} analizándose`}
      detail="El total se actualiza cuando termine el análisis."
    />
  );
}

/**
 * Comidas en `failed`: aviso tranquilo, sin rojo (no es una alarma).
 * TODO(RF-08): llevar a esa comida en el historial cuando exista la pantalla.
 */
export function FailedNotice({ count }: { count: number }) {
  return (
    <Notice
      leading={<NoticeIcon icon={ImageOff} />}
      title={`${mealsCount(count)} no se ${count === 1 ? "pudo" : "pudieron"} analizar`}
      detail="No suman en el total. Podés registrarlas de nuevo con otra foto."
    />
  );
}

/** Día sin comidas: neutral, sin presión. */
export function EmptyDayNotice() {
  return (
    <Notice
      leading={<NoticeIcon icon={UtensilsCrossed} />}
      title="Todavía no hay comidas hoy"
      detail="Cuando registres una, vas a ver acá cómo va tu día."
    />
  );
}

function NoticeIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon color={colors.inkMuted} size={sizes.icon} strokeWidth={sizes.iconStroke} />;
}

function Notice({ leading, title, detail }: { leading: ReactNode; title: string; detail: string }) {
  return (
    <Card accessibilityLiveRegion="polite">
      <View style={styles.row}>
        {leading}
        <Text variant="bodyStrong" style={styles.title}>
          {title}
        </Text>
      </View>
      <Text variant="small" color="inkMuted">
        {detail}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { flexShrink: 1 },
});

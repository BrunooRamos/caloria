import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Button, Card, Skeleton, Text } from "@/components";
import { colors, sizes, spacing, typography } from "@/theme";

export interface AnalyzingStateProps {
  slow: boolean;
  stalled: boolean;
  connectionIssue: boolean;
  onRetry(): void;
}

const MESSAGES = {
  normal: {
    title: "Analizando tu comida…",
    detail: "Estimamos las calorías y los macros a partir de la foto. Tarda unos segundos.",
  },
  // No se da por fallida: el Worker puede estar reintentando.
  slow: {
    title: "Está tardando más de lo normal",
    detail: "Seguimos analizando tu comida. A veces lleva un poco más.",
  },
  stalled: {
    title: "Todavía no tenemos el resultado",
    detail: "El análisis puede seguir en curso. Volvé a consultar en un rato.",
  },
};

export function AnalyzingState({ slow, stalled, connectionIssue, onRetry }: AnalyzingStateProps) {
  const { title, detail } = MESSAGES[stalled ? "stalled" : slow ? "slow" : "normal"];
  return (
    <>
      <Card accessibilityLiveRegion="polite">
        <View style={styles.status}>
          {!stalled && <ActivityIndicator color={colors.primary} />}
          <Text variant="h3" style={styles.title}>
            {title}
          </Text>
        </View>
        <Text variant="small" color="inkMuted">
          {detail}
        </Text>
        {connectionIssue && !stalled && (
          <Text variant="small" color="inkMuted">
            Ahora no hay conexión. Seguimos intentando.
          </Text>
        )}
        {stalled && <Button variant="secondary" title="Actualizar" onPress={onRetry} />}
      </Card>
      <ResultSkeleton />
    </>
  );
}

/** La forma del resultado mientras llega: total, confianza, plato, macros e ingredientes. */
function ResultSkeleton() {
  return (
    <View style={styles.skeleton}>
      <View style={styles.summary}>
        <Skeleton height={typography.display.lineHeight} width="70%" />
        <Skeleton height={typography.caption.lineHeight + spacing.xs} width="35%" rounded="full" />
        <Skeleton height={typography.h3.lineHeight} width="55%" />
      </View>
      <View style={styles.macros}>
        {[0, 1, 2].map((key) => (
          <View key={key} style={styles.macro}>
            <Skeleton height={sizes.control} rounded="md" />
          </View>
        ))}
      </View>
      <Skeleton height={sizes.control * 3} rounded="lg" />
    </View>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { flexShrink: 1 },
  skeleton: { gap: spacing.xl },
  summary: { gap: spacing.sm },
  macros: { flexDirection: "row", gap: spacing.sm },
  macro: { flex: 1 },
});

import { StyleSheet, View } from "react-native";
import { Card, Skeleton } from "@/components";
import { sizes, spacing, typography } from "@/theme";

/** La forma del dashboard mientras carga: la racha, la barra de kcal y las tres de macros. */
export function DashboardSkeleton() {
  return (
    <View
      accessible
      accessibilityLabel="Cargando tu día"
      accessibilityState={{ busy: true }}
      style={styles.root}
    >
      <Card>
        <Skeleton height={typography.caption.lineHeight} width="20%" />
        <Skeleton height={typography.display.lineHeight} width="40%" />
        <Skeleton height={typography.small.lineHeight} width="35%" />
      </Card>
      <Card>
        <Skeleton height={typography.caption.lineHeight} width="25%" />
        <Skeleton height={typography.display.lineHeight} width="70%" />
        <Skeleton height={typography.small.lineHeight} width="35%" />
        <Skeleton height={sizes.progressLarge} rounded="full" />
      </Card>
      <Card>
        {[0, 1, 2].map((key) => (
          <View key={key} style={styles.macro}>
            <Skeleton height={typography.caption.lineHeight} width="30%" />
            <Skeleton height={typography.bodyStrong.lineHeight} width="55%" />
            <Skeleton height={sizes.progress} rounded="full" />
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xl },
  macro: { gap: spacing.xs, paddingVertical: spacing.xxs },
});

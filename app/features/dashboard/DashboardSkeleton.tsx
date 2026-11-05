import { StyleSheet, View } from "react-native";
import { Card, Skeleton } from "@/components";
import { MealListSkeleton } from "@/features/meals/MealRow";
import { sizes, spacing, typography } from "@/theme";

/** El total del día mientras carga: va dentro de la tarjeta principal, junto a "Registrar comida". */
export function KcalSkeleton() {
  return (
    <View
      accessible
      accessibilityLabel="Cargando tu día"
      accessibilityState={{ busy: true }}
      style={styles.kcal}
    >
      <Skeleton height={typography.caption.lineHeight} width="25%" />
      <Skeleton height={typography.display.lineHeight} width="70%" />
      <Skeleton height={typography.small.lineHeight} width="35%" />
      <Skeleton height={sizes.progressLarge} rounded="full" />
    </View>
  );
}

/**
 * El resto del dashboard mientras carga: la lista del día, los macros y la racha. Para el lector de
 * pantalla alcanza con "Cargando tu día".
 */
export function DashboardSkeleton() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.root}
    >
      <View style={styles.section}>
        <Skeleton height={typography.h2.lineHeight} width="45%" />
        <MealListSkeleton rows={2} />
      </View>
      <Card>
        {[0, 1, 2].map((key) => (
          <View key={key} style={styles.macro}>
            <Skeleton height={typography.caption.lineHeight} width="30%" />
            <Skeleton height={typography.bodyStrong.lineHeight} width="55%" />
            <Skeleton height={sizes.progress} rounded="full" />
          </View>
        ))}
      </Card>
      <Card>
        <Skeleton height={typography.caption.lineHeight} width="20%" />
        <Skeleton height={typography.display.lineHeight} width="40%" />
        <Skeleton height={typography.small.lineHeight} width="35%" />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  kcal: { gap: spacing.xs },
  root: { gap: spacing.xl },
  section: { gap: spacing.sm },
  macro: { gap: spacing.xs, paddingVertical: spacing.xxs },
});

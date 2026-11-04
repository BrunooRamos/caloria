import { Flame } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { Badge, Card, Text } from "@/components";
import type { DailyStreak } from "@/services/dashboard";
import { colors, sizes, spacing } from "@/theme";
import { dayUnit, daysCount, formatNumber } from "./format";

const START_INVITE = "Registrá una comida para empezar tu racha.";

/** Para el lector de pantalla, sin separador de miles: "4 días". */
const spokenDays = (count: number) => `${count} ${dayUnit(count)}`;

export function StreakCard({ streak: { current, best } }: { streak: DailyStreak }) {
  const isBest = current > 1 && current === best;
  const accessibilityLabel = [
    `Racha actual: ${spokenDays(current)}.`,
    best > 0 && `Mejor racha: ${spokenDays(best)}.`,
    isBest && "Es tu mejor racha.",
    current === 0 && START_INVITE,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Card accessible accessibilityLabel={accessibilityLabel}>
      <View style={styles.header}>
        <Flame color={colors.primary} size={sizes.iconDense} strokeWidth={sizes.iconStroke} />
        <Text variant="caption" color="inkMuted">
          Racha
        </Text>
      </View>
      {current > 0 ? (
        <View style={styles.value}>
          <Text variant="display" color="primary">
            {formatNumber(current)}
          </Text>
          <Text variant="h3" color="primary">
            {dayUnit(current)}
          </Text>
        </View>
      ) : (
        <Text variant="bodyStrong">{START_INVITE}</Text>
      )}
      {isBest && <Badge label="Tu mejor racha" />}
      {best > 0 && (
        <Text variant="small" color="inkMuted">
          {`Mejor racha: ${daysCount(best)}`}
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  value: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: spacing.xs,
  },
});

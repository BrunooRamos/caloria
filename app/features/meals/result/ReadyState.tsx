import { StyleSheet, View } from "react-native";
import { Card, ConfidenceBadge, Text } from "@/components";
import type { ReadyMeal } from "@/services/meals";
import { spacing } from "@/theme";
import { confidenceLevel } from "../confidence";
import { formatRange } from "../format";

const MACROS = [
  { key: "protein", label: "Proteínas" },
  { key: "carbs", label: "Carbohidratos" },
  { key: "fat", label: "Grasas" },
] as const;

export function ReadyState({ meal }: { meal: ReadyMeal }) {
  return (
    <>
      <View style={styles.summary}>
        <Text variant="display" color="primary">
          {formatRange(meal.kcal, "kcal")}
        </Text>
        <ConfidenceBadge level={confidenceLevel(meal.confidence)} />
        <Text variant="h3" accessibilityRole="header">
          {meal.dish}
        </Text>
      </View>

      <Card>
        <View style={styles.macros}>
          {MACROS.map(({ key, label }) => (
            <View key={key} style={styles.macro}>
              <Text variant="caption" color="inkMuted">
                {label}
              </Text>
              <Text variant="bodyStrong">{formatRange(meal.macros[key], "g")}</Text>
            </View>
          ))}
        </View>
      </Card>

      {meal.items.length > 0 && (
        <Card>
          <Text variant="h3" accessibilityRole="header">
            Ingredientes
          </Text>
          {meal.items.map((item, index) => (
            <View key={`${index}-${item.name}`} style={styles.item}>
              <Text>{item.name}</Text>
              <Text variant="small" color="inkMuted">
                {formatRange(item.grams, "g")} · {formatRange(item.kcal, "kcal")}
              </Text>
            </View>
          ))}
        </Card>
      )}

      {meal.comment && (
        <Text variant="small" color="inkMuted">
          “{meal.comment.text}”
        </Text>
      )}

      {/* acá va el acceso para corregir el plato, los ingredientes, las kcal y los macros. */}
    </>
  );
}

const styles = StyleSheet.create({
  summary: { gap: spacing.xs },
  macros: { flexDirection: "row", gap: spacing.sm },
  macro: { flex: 1, gap: spacing.xxs },
  item: { gap: spacing.xxs },
});

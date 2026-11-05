import { StyleSheet, View } from "react-native";
import { Card, Text } from "@/components";
import type { Targets } from "@/services/users";
import { spacing } from "@/theme";

const MACROS = [
  { key: "proteinG", label: "Proteínas" },
  { key: "carbsG", label: "Carbohidratos" },
  { key: "fatG", label: "Grasas" },
] as const satisfies { key: keyof Targets; label: string }[];

export function TargetsCard({ targets }: { targets: Targets }) {
  return (
    <Card>
      <Text variant="caption" color="inkMuted">
        Calorías por día
      </Text>
      <View
        accessible
        accessibilityLabel={`${targets.kcal} kilocalorías por día`}
        style={styles.kcal}
      >
        <Text variant="display" color="primary">
          {targets.kcal}
        </Text>
        <Text variant="h3" color="primary">
          kcal
        </Text>
      </View>
      <View style={styles.macros}>
        {MACROS.map(({ key, label }) => (
          <View
            key={key}
            accessible
            accessibilityLabel={`${label}: ${targets[key]} gramos`}
            style={styles.macro}
          >
            <Text variant="caption" color="inkMuted">
              {label}
            </Text>
            <Text variant="bodyStrong">{targets[key]} g</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  kcal: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs },
  macros: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.xs },
  macro: { flexGrow: 1, gap: spacing.xxs },
});

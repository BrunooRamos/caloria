import { StyleSheet, View } from "react-native";
import { ProgressBar, Text } from "@/components";
import type { DailyRange } from "@/services/dashboard";
import { spacing } from "@/theme";
import { formatDailyRange, formatNumber, progressOf } from "./format";

export interface NutrientBarProps {
  label: string;
  consumed: DailyRange;
  target: number;
  unit: "kcal" | "g";
  /** La de kcal: número grande y barra más alta. */
  main?: boolean;
}

const SPOKEN_UNITS = { kcal: "kilocalorías", g: "gramos" } as const;

/** El rango para el lector de pantalla, sin separador de miles: "entre 1450 y 1820 kilocalorías". */
function spokenRange({ min, max }: DailyRange, unit: NutrientBarProps["unit"]): string {
  const low = Math.round(min);
  const high = Math.round(max);
  const value = low === high ? `${low}` : `entre ${low} y ${high}`;
  return `${value} ${SPOKEN_UNITS[unit]}`;
}

export function NutrientBar({ label, consumed, target, unit, main = false }: NutrientBarProps) {
  const range = formatDailyRange(consumed);
  const goal = `de ${formatNumber(target)} ${unit}`;
  const accessibilityLabel =
    `${label}: ${spokenRange(consumed, unit)}, ` +
    `de una meta de ${Math.round(target)} ${SPOKEN_UNITS[unit]}`;

  return (
    <View accessible accessibilityLabel={accessibilityLabel} style={styles.root}>
      <Text variant="caption" color="inkMuted">
        {label}
      </Text>
      {main ? (
        <View>
          <View style={styles.mainValue}>
            <Text variant="display" color="primary">
              {range}
            </Text>
            <Text variant="h3" color="primary">
              {unit}
            </Text>
          </View>
          <Text variant="small" color="inkMuted">
            {goal}
          </Text>
        </View>
      ) : (
        <Text variant="bodyStrong">
          {`${range} ${unit} `}
          <Text variant="small" color="inkMuted">
            {goal}
          </Text>
        </Text>
      )}
      <ProgressBar progress={progressOf(consumed.mid, target)} size={main ? "large" : "regular"} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs },
  mainValue: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: spacing.xs,
  },
});

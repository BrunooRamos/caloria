import { Info } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { Text } from "@/components";
import { colors, radius, sizes, spacing } from "@/theme";

export const HEALTH_DISCLAIMER =
  "CalorIA no reemplaza el consejo de un profesional de la salud. Las metas son una estimación general: si tenés una condición de salud o dudas sobre tu alimentación, consultá con un profesional.";

export function HealthDisclaimer() {
  return (
    <View accessible accessibilityRole="text" style={styles.box}>
      <Info size={sizes.iconDense} strokeWidth={sizes.iconStrokeLight} color={colors.primary} />
      <Text variant="small" style={styles.text}>
        {HEALTH_DISCLAIMER}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.sageSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  text: { flex: 1 },
});

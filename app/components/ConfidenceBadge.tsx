import { StyleSheet, View } from "react-native";
import { colors, radius, spacing } from "@/theme";
import type { ColorToken } from "@/theme";
import { Text } from "./Text";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface ConfidenceBadgeProps {
  level: ConfidenceLevel;
}

const LEVELS: Record<ConfidenceLevel, { label: string; background: ColorToken; text: ColorToken }> =
  {
    high: { label: "Confianza alta", background: "sageSoft", text: "primary" },
    medium: { label: "Confianza media", background: "surfaceAlt", text: "sageText" },
    low: { label: "Confianza baja", background: "warningSoft", text: "warning" },
  };

export function ConfidenceBadge({ level }: ConfidenceBadgeProps) {
  const { label, background, text } = LEVELS[level];
  return (
    <View style={[styles.badge, { backgroundColor: colors[background] }]}>
      <Text variant="caption" color={text}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
});

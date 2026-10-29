import { StyleSheet, View } from "react-native";
import { colors, radius, spacing } from "@/theme";
import type { ColorToken } from "@/theme";
import { Text } from "./Text";

export interface BadgeProps {
  label: string;
  background?: ColorToken;
  text?: ColorToken;
}

/** Pill chica con texto `caption` (skill §5). Por defecto `sageSoft` con texto `primary`. */
export function Badge({ label, background = "sageSoft", text = "primary" }: BadgeProps) {
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

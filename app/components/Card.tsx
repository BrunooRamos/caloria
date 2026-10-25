import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import type { ViewProps } from "react-native";
import { borderWidth, colors, radius, spacing } from "@/theme";

export type CardProps = PropsWithChildren<Omit<ViewProps, "style">>;

export function Card({ children, ...props }: CardProps) {
  return (
    <View {...props} style={styles.card}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: borderWidth.default,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
});

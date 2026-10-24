import { StyleSheet, View } from "react-native";
import { colors, radius, spacing } from "@/theme";
import { Text } from "./Text";

export interface FormErrorProps {
  message: string | null;
}

export function FormError({ message }: FormErrorProps) {
  if (!message) return null;
  return (
    <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.box}>
      <Text variant="small" color="danger">
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});

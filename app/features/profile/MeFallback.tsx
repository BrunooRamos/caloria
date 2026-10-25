import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Button, FormError } from "@/components";
import { errorMessage } from "@/services/error-messages";
import { colors, spacing } from "@/theme";
import type { MeState } from "./useMe";

export interface MeFallbackProps {
  state: Exclude<MeState, { status: "ready" }>;
  onRetry(): void;
}

export function MeFallback({ state, onRetry }: MeFallbackProps) {
  if (state.status === "loading") {
    return (
      <View style={styles.loading}>
        <ActivityIndicator
          color={colors.primary}
          accessibilityLabel="Cargando tus metas"
          size="large"
        />
      </View>
    );
  }
  return (
    <View style={styles.error}>
      <FormError message={errorMessage(state.error)} />
      <Button variant="secondary" title="Reintentar" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: spacing.xxxl, alignItems: "center" },
  error: { gap: spacing.md },
});

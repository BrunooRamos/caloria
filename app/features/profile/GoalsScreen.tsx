import { StyleSheet, View } from "react-native";
import { Button, Screen, Text } from "@/components";
import { useSession } from "@/store/session";
import { spacing } from "@/theme";
import { HealthDisclaimer } from "./HealthDisclaimer";
import { MeFallback } from "./MeFallback";
import { TargetsCard } from "./TargetsCard";
import { useMe } from "./useMe";

export default function GoalsScreen() {
  const { finishOnboarding } = useSession();
  const { state, reload } = useMe();

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Text variant="h1" accessibilityRole="header">
          Tus metas diarias
        </Text>
        <Text color="inkMuted">
          Las calculamos con los datos que cargaste. Si algo cambia, las podés actualizar desde tu
          perfil.
        </Text>
      </View>

      <View style={styles.body}>
        {state.status === "ready" ? (
          <TargetsCard targets={state.me.targets} />
        ) : (
          <MeFallback state={state} onRetry={reload} />
        )}
        <HealthDisclaimer />
      </View>

      <View style={styles.spacer} />

      <Button
        title={state.status === "error" ? "Ir al inicio" : "Empezar"}
        disabled={state.status === "loading"}
        onPress={finishOnboarding}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs },
  body: { gap: spacing.xl, marginTop: spacing.xl },
  spacer: { flexGrow: 1, minHeight: spacing.xl },
});

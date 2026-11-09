import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Button, Screen, Text } from "@/components";
import { spacing } from "@/theme";
import { HealthDisclaimer } from "./HealthDisclaimer";
import { MeFallback } from "./MeFallback";
import { TargetsCard } from "./TargetsCard";
import { useMe } from "./useMe";

/** Tus metas diarias: las que calcula el Backend con tus datos. Para cambiarlas, tus datos. */
export default function TargetsScreen() {
  const { state, reload } = useMe();
  return (
    <Screen scroll edges={["bottom", "left", "right"]}>
      <View style={styles.content}>
        {state.status === "ready" ? (
          <TargetsCard targets={state.me.targets} />
        ) : (
          <MeFallback state={state} onRetry={reload} />
        )}
        <HealthDisclaimer />
        <View style={styles.data}>
          <Text color="inkMuted">
            Las calculamos con tus datos. Si cambió tu peso, tu actividad o tu objetivo,
            actualizalos y las recalculamos.
          </Text>
          <Button
            variant="secondary"
            title="Cambiar tus datos"
            onPress={() => router.push("/profile/data")}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl },
  data: { gap: spacing.sm },
});

import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button, Screen, Text } from "@/components";
import { useSession } from "@/store/session";
import { spacing } from "@/theme";

export default function ProfileScreen() {
  const { signOut } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function confirmSignOut() {
    setSigningOut(true);
    await signOut();
  }

  return (
    <Screen edges={["bottom", "left", "right"]}>
      <View style={styles.section}>
        {confirming ? (
          <>
            <Text variant="h3" accessibilityRole="header">
              ¿Querés cerrar la sesión?
            </Text>
            <Text color="inkMuted">
              Para volver a entrar vas a necesitar tu email y tu contraseña.
            </Text>
            <View style={styles.actions}>
              <Button
                variant="secondary"
                title="Sí, cerrar sesión"
                loading={signingOut}
                onPress={confirmSignOut}
              />
              <Button
                variant="ghost"
                title="Cancelar"
                disabled={signingOut}
                onPress={() => setConfirming(false)}
              />
            </View>
          </>
        ) : (
          <Button variant="secondary" title="Cerrar sesión" onPress={() => setConfirming(true)} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  actions: { gap: spacing.xs, marginTop: spacing.xs },
});

import { Link, Redirect } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Button, Screen, Text } from "@/components";
import { useSignUpDraft } from "@/features/auth/sign-up-draft";
import { spacing } from "@/theme";

export default function OnboardingScreen() {
  const { credentials } = useSignUpDraft();
  if (!credentials) return <Redirect href="/register" />;

  return (
    <Screen>
      <View style={styles.content}>
        <Text variant="h1" accessibilityRole="header">
          Tu perfil
        </Text>
        <Text color="inkMuted">
          Acá vas a completar tus datos para calcular tus metas. Esta parte todavía no está lista.
        </Text>
        <Link href="/register" dismissTo asChild>
          <Button variant="ghost" title="Volver" />
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingTop: spacing.xxl },
});

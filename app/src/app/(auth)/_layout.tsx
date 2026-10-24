import { Stack } from "expo-router";
import { StyleSheet } from "react-native";
import { SignUpDraftProvider } from "@/features/auth/sign-up-draft";
import { colors } from "@/theme";

export const unstable_settings = { initialRouteName: "login" };

export default function AuthLayout() {
  return (
    <SignUpDraftProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: styles.content }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="onboarding" />
      </Stack>
    </SignUpDraftProvider>
  );
}

const styles = StyleSheet.create({
  content: { backgroundColor: colors.primary },
});

import { Stack } from "expo-router";
import { StyleSheet } from "react-native";
import { useSession } from "@/store/session";
import { colors, fonts, typography } from "@/theme";

export default function AppLayout() {
  const { pendingGoals } = useSession();

  return (
    <Stack
      screenOptions={{
        headerStyle: styles.header,
        headerTitleStyle: styles.headerTitle,
        headerTintColor: colors.primary,
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        contentStyle: styles.content,
      }}
    >
      <Stack.Protected guard={pendingGoals}>
        <Stack.Screen name="goals" options={{ headerShown: false, gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!pendingGoals}>
        <Stack.Screen name="index" options={{ title: "CalorIA" }} />
        <Stack.Screen name="profile" options={{ title: "Perfil" }} />
        <Stack.Screen
          name="capture"
          options={{ headerShown: false, animation: "slide_from_bottom" }}
        />
        <Stack.Screen name="meals/[id]" options={{ title: "Tu comida" }} />
        <Stack.Screen name="history" options={{ title: "Historial" }} />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.background },
  headerTitle: { ...fonts.medium, fontSize: typography.h3.fontSize, color: colors.primary },
  content: { backgroundColor: colors.background },
});

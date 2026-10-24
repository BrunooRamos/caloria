import { Stack } from "expo-router";
import { StyleSheet } from "react-native";
import { colors, fonts, typography } from "@/theme";

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: styles.header,
        headerTitleStyle: styles.headerTitle,
        headerTintColor: colors.primary,
        headerShadowVisible: false,
        contentStyle: styles.content,
      }}
    >
      <Stack.Screen name="index" options={{ title: "CalorIA" }} />
      <Stack.Screen name="profile" options={{ title: "Perfil" }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.background },
  headerTitle: { ...fonts.medium, fontSize: typography.h3.fontSize, color: colors.ink },
  content: { backgroundColor: colors.background },
});

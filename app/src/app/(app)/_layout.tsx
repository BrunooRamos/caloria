import { Stack } from "expo-router";
import { StyleSheet } from "react-native";
import { ScreenHeader, ToastProvider } from "@/components";
import { useNotifications } from "@/features/notifications/useNotifications";
import { MealCacheProvider } from "@/store/meals";
import { useSession } from "@/store/session";
import { colors } from "@/theme";

export const unstable_settings = { anchor: "(tabs)" };

export default function AppLayout() {
  const { pendingGoals } = useSession();
  useNotifications();

  return (
    <ToastProvider>
      <MealCacheProvider>
        <Stack
          screenOptions={{
            header: ({ options }) => <ScreenHeader title={options.title ?? ""} />,
            contentStyle: styles.content,
          }}
        >
          <Stack.Protected guard={pendingGoals}>
            <Stack.Screen name="goals" options={{ headerShown: false, gestureEnabled: false }} />
          </Stack.Protected>
          <Stack.Protected guard={!pendingGoals}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="capture"
              options={{ headerShown: false, animation: "slide_from_bottom" }}
            />
            <Stack.Screen name="meals/[id]" options={{ title: "Tu comida" }} />
            <Stack.Screen name="meals/[id]/edit" options={{ title: "Corregir comida" }} />
            <Stack.Screen name="wrapped/[week]" options={{ title: "Tu semana" }} />
            <Stack.Screen name="profile/targets" options={{ title: "Tus metas diarias" }} />
            <Stack.Screen name="profile/data" options={{ title: "Tus datos" }} />
            <Stack.Screen name="profile/tone" options={{ title: "Comentario de tus comidas" }} />
            <Stack.Screen name="profile/notifications" options={{ title: "Avisos" }} />
            <Stack.Screen name="profile/delete" options={{ title: "Eliminar cuenta" }} />
            <Stack.Screen name="plan" options={{ title: "Tu plan" }} />
            <Stack.Screen
              name="billing/return"
              options={{ headerShown: false, animation: "none" }}
            />
          </Stack.Protected>
        </Stack>
      </MealCacheProvider>
    </ToastProvider>
  );
}

const styles = StyleSheet.create({
  content: { backgroundColor: colors.background },
});

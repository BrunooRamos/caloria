import { Stack } from "expo-router";

export const unstable_settings = { initialRouteName: "login" };

export default function AuthLayout() {
  return (
    <Stack>
      <Stack.Screen name="login" options={{ title: "Ingresar" }} />
      <Stack.Screen name="register" options={{ title: "Crear cuenta" }} />
    </Stack>
  );
}

import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SessionProvider, useSession } from "@/store/session";
import { fontFiles } from "@/theme";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <SessionProvider>
      <RootNavigator />
      <StatusBar style="auto" />
    </SessionProvider>
  );
}

function RootNavigator() {
  const { status } = useSession();
  const [fontsLoaded, fontError] = useFonts(fontFiles);
  const ready = status !== "loading" && (fontsLoaded || fontError !== null);

  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  if (!ready) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === "authenticated"} redirectTo="/login">
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={status === "unauthenticated"} redirectTo="/">
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

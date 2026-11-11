import { Tabs } from "expo-router/tabs";
import type { BottomTabBarProps } from "expo-router/tabs";
import { CalendarDays, Camera, CircleUserRound, History, House } from "lucide-react-native";
import { StyleSheet } from "react-native";
import { TabBar, tabIcon } from "@/components";
import { CaptureGateProvider, useOpenCapture } from "@/features/billing/captureGate";
import { colors } from "@/theme";

/** Secciones principales, con "Registrar" siempre a mano en el medio. */
export default function TabsLayout() {
  // Sin análisis en el mes, "Registrar" avisa en vez de abrir la cámara.
  return (
    <CaptureGateProvider>
      <Tabs
        tabBar={(props) => <RegisterTabBar {...props} />}
        screenOptions={{ headerShown: false, sceneStyle: styles.scene }}
      >
        <Tabs.Screen name="index" options={{ title: "Inicio", tabBarIcon: tabIcon(House) }} />
        <Tabs.Screen
          name="history"
          options={{ title: "Historial", tabBarIcon: tabIcon(History) }}
        />
        <Tabs.Screen
          name="wrapped"
          options={{ title: "Semana", tabBarIcon: tabIcon(CalendarDays) }}
        />
        <Tabs.Screen
          name="profile"
          options={{ title: "Perfil", tabBarIcon: tabIcon(CircleUserRound) }}
        />
      </Tabs>
    </CaptureGateProvider>
  );
}

function RegisterTabBar(props: BottomTabBarProps) {
  const openCapture = useOpenCapture();
  return <TabBar {...props} action={{ icon: Camera, title: "Registrar", onPress: openCapture }} />;
}

const styles = StyleSheet.create({
  scene: { backgroundColor: colors.background },
});

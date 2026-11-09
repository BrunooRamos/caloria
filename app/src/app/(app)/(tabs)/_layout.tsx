import { router } from "expo-router";
import { Tabs } from "expo-router/tabs";
import { CalendarDays, Camera, CircleUserRound, History, House } from "lucide-react-native";
import { StyleSheet } from "react-native";
import { TabBar, tabIcon } from "@/components";
import { colors } from "@/theme";

const REGISTER = {
  icon: Camera,
  title: "Registrar",
  onPress: () => router.push("/capture"),
};

/** Secciones principales, con "Registrar" siempre a mano en el medio. */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} action={REGISTER} />}
      screenOptions={{ headerShown: false, sceneStyle: styles.scene }}
    >
      <Tabs.Screen name="index" options={{ title: "Inicio", tabBarIcon: tabIcon(House) }} />
      <Tabs.Screen name="history" options={{ title: "Historial", tabBarIcon: tabIcon(History) }} />
      <Tabs.Screen
        name="wrapped"
        options={{ title: "Semana", tabBarIcon: tabIcon(CalendarDays) }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Perfil", tabBarIcon: tabIcon(CircleUserRound) }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  scene: { backgroundColor: colors.background },
});

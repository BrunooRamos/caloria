import { Link, router } from "expo-router";
import { Camera } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { Button, Fab, Screen, Text } from "@/components";
import { SessionDebug } from "@/features/auth/SessionDebug";
import { spacing } from "@/theme";

export default function HomeScreen() {
  return (
    <Screen edges={["bottom", "left", "right"]}>
      <View style={styles.content}>
        <Text>Sesión iniciada</Text>
        <Link href="/profile" asChild>
          <Button variant="secondary" title="Mi perfil" />
        </Link>
        {__DEV__ && <SessionDebug />}
      </View>
      <Fab icon={Camera} label="Registrar comida" onPress={() => router.push("/capture")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
});

import { Button, Text, View } from "react-native";
import { SessionDebug } from "@/features/auth/SessionDebug";
import { useSession } from "@/store/session";

export default function HomeScreen() {
  const { signOut } = useSession();

  return (
    <View>
      <Text>Sesión iniciada</Text>
      {__DEV__ && <SessionDebug />}
      <Button title="Cerrar sesión" onPress={signOut} />
    </View>
  );
}

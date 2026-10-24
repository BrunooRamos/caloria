import { useState } from "react";
import { Button, Text, View } from "react-native";
import { api } from "@/services/api";
import { errorMessage } from "@/services/error-messages";

export function SessionDebug() {
  const [result, setResult] = useState<string | null>(null);

  async function probe() {
    setResult("Enviando…");
    try {
      await Promise.all([api.get("/users/me"), api.get("/users/me")]);
      setResult("OK: las dos requests respondieron");
    } catch (err) {
      setResult(`Error: ${errorMessage(err)}`);
    }
  }

  return (
    <View>
      <Button title="Probar 2 requests en paralelo (dev)" onPress={probe} />
      {result !== null && <Text>{result}</Text>}
    </View>
  );
}

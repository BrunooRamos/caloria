import { Link } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Button, Text, TextInput, View } from "react-native";
import { errorMessage } from "@/services/api-error";
import { useSession } from "@/store/session";

export default function LoginScreen() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await signIn({ email: email.trim(), password });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View>
      <TextInput
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <TextInput
        placeholder="Contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
      />
      {error !== null && <Text>{error}</Text>}
      {submitting ? (
        <ActivityIndicator />
      ) : (
        <Button title="Ingresar" onPress={handleSubmit} disabled={!email || !password} />
      )}
      <Link href="/register" asChild>
        <Button title="Crear una cuenta" />
      </Link>
    </View>
  );
}

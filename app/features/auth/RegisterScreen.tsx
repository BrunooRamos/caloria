import { Link } from "expo-router";
import { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";

/**
 * Placeholder: `POST /auth/register` exige el perfil completo, que se pide en el
 * onboarding (ticket aparte). Ese flujo llama a `signUp` de `useSession`.
 */
export default function RegisterScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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
        placeholder="Contraseña (mínimo 8 caracteres)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <Text>Para crear la cuenta falta completar tu perfil.</Text>
      <Button title="Crear cuenta" onPress={() => undefined} disabled />
      <Link href="/login" asChild>
        <Button title="Ya tengo cuenta" />
      </Link>
    </View>
  );
}

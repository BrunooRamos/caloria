import { Link } from "expo-router";
import { useRef } from "react";
import { StyleSheet, View } from "react-native";
import type { TextInputInstance } from "react-native";
import { Button, FormError, Input, Logo, Screen, Text } from "@/components";
import { useSession } from "@/store/session";
import { spacing } from "@/theme";
import { passwordPlaceholders } from "./placeholders";
import { useForm } from "./useForm";
import { loginSchema } from "./validation";

export default function LoginScreen() {
  const { signIn } = useSession();
  const passwordRef = useRef<TextInputInstance>(null);
  const form = useForm({
    schema: loginSchema,
    initialValues: { email: "", password: "" },
    onSubmit: signIn,
    messages: { UNAUTHORIZED: "El email o la contraseña no son correctos." },
  });

  return (
    <Screen scroll tone="brand">
      <View style={styles.header}>
        <Logo />
        <Text variant="h1" color="cream" accessibilityRole="header" style={styles.centered}>
          Hola de nuevo
        </Text>
        <Text color="onPrimaryMuted" style={styles.centered}>
          Ingresá con tu email y tu contraseña.
        </Text>
      </View>

      <View style={styles.spacer} />

      <View style={styles.form}>
        <View style={styles.fields}>
          <Input
            {...form.field("email")}
            label="Email"
            placeholder="tu@email.com"
            keyboardType="email-address"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="username"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <Input
            {...form.field("password")}
            ref={passwordRef}
            label="Contraseña"
            {...passwordPlaceholders}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={form.submit}
          />
          <FormError message={form.formError} />
        </View>
        <View style={styles.actions}>
          <Button title="Ingresar" loading={form.submitting} onPress={form.submit} />
          <Link href="/register" asChild>
            <Button variant="ghost" title="Crear una cuenta" />
          </Link>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", gap: spacing.xs },
  spacer: { flexGrow: 1, minHeight: spacing.xl, maxHeight: spacing.xxxl },
  centered: { textAlign: "center" },
  form: { gap: spacing.xxl },
  fields: { gap: spacing.md },
  actions: { gap: spacing.md },
});

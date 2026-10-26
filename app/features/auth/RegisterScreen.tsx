import { Link, router } from "expo-router";
import { useRef } from "react";
import { StyleSheet, View } from "react-native";
import type { TextInputInstance } from "react-native";
import { Button, FormError, Input, Logo, Screen, Text } from "@/components";
import { spacing } from "@/theme";
import { passwordPlaceholders } from "./placeholders";
import { useSignUpDraft } from "./sign-up-draft";
import { useForm } from "./useForm";
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_CHARS, registerSchema } from "./validation";

export default function RegisterScreen() {
  const draft = useSignUpDraft();
  const passwordRef = useRef<TextInputInstance>(null);
  const confirmPasswordRef = useRef<TextInputInstance>(null);
  const form = useForm({
    schema: registerSchema,
    initialValues: { email: draft.credentials?.email ?? "", password: "", confirmPassword: "" },
    onSubmit: async ({ email, password }) => {
      draft.start({ email, password });
      router.push("/onboarding");
    },
    fieldErrors: { EMAIL_TAKEN: "email" },
    externalError: draft.error,
  });

  return (
    <Screen scroll tone="brand">
      <View style={styles.header}>
        <Logo />
        <Text variant="h1" color="cream" accessibilityRole="header" style={styles.centered}>
          Creá tu cuenta
        </Text>
        <Text color="onPrimaryMuted" style={styles.centered}>
          Después te pedimos unos datos para tus metas.
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
            autoComplete="new-password"
            textContentType="newPassword"
            passwordRules={`minlength: ${PASSWORD_MIN_CHARS}; maxlength: ${PASSWORD_MAX_BYTES};`}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => confirmPasswordRef.current?.focus()}
          />
          <Input
            {...form.field("confirmPassword")}
            ref={confirmPasswordRef}
            label="Repetí la contraseña"
            {...passwordPlaceholders}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={form.submit}
          />
          <FormError message={form.formError} />
        </View>
        <View style={styles.actions}>
          <Button title="Continuar" loading={form.submitting} onPress={form.submit} />
          <Link href="/login" dismissTo asChild>
            <Button variant="ghost" title="Ya tengo cuenta" />
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
  // Los botones van separados de los campos para que no queden pegados al último input.
  form: { gap: spacing.xxl },
  fields: { gap: spacing.md },
  actions: { gap: spacing.md },
});

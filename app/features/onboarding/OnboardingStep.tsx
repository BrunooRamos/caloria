import { router } from "expo-router";
import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import { Button, FormError, Screen, Text } from "@/components";
import { spacing } from "@/theme";

export const STEP_COUNT = 3;

export interface OnboardingStepProps extends PropsWithChildren {
  step: number;
  title: string;
  intro: string;
  submitTitle?: string;
  submitting: boolean;
  formError: string | null;
  onSubmit(): void;
}

export function OnboardingStep({
  step,
  title,
  intro,
  submitTitle = "Continuar",
  submitting,
  formError,
  onSubmit,
  children,
}: OnboardingStepProps) {
  return (
    <Screen scroll>
      <View style={styles.header}>
        <Text variant="caption" color="sageText">
          Paso {step} de {STEP_COUNT}
        </Text>
        <Text variant="h1" accessibilityRole="header">
          {title}
        </Text>
        <Text color="inkMuted">{intro}</Text>
      </View>

      <View style={styles.fields}>{children}</View>

      <View style={styles.spacer} />

      <View style={styles.actions}>
        <FormError message={formError} />
        <Button title={submitTitle} loading={submitting} onPress={onSubmit} />
        <Button
          variant="ghost"
          title="Volver"
          disabled={submitting}
          onPress={() => router.back()}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs },
  fields: { gap: spacing.xl, marginTop: spacing.xl },
  spacer: { flexGrow: 1, minHeight: spacing.xl },
  actions: { gap: spacing.md },
});

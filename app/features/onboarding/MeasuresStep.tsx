import { Redirect, router } from "expo-router";
import { useRef } from "react";
import type { TextInputInstance } from "react-native";
import { Input } from "@/components";
import { useSignUpDraft } from "@/features/auth/sign-up-draft";
import { useForm } from "@/features/auth/useForm";
import { measuresSchema } from "@/features/profile/validation";
import { OnboardingStep } from "./OnboardingStep";

export default function MeasuresStep() {
  const draft = useSignUpDraft();
  const weightRef = useRef<TextInputInstance>(null);
  const form = useForm({
    schema: measuresSchema,
    initialValues: { heightCm: draft.profile.heightCm, weightKg: draft.profile.weightKg },
    onChange: draft.saveProfile,
    onSubmit: async () => {
      router.push("/onboarding/routine");
    },
  });

  if (!draft.credentials) return <Redirect href="/register" />;

  return (
    <OnboardingStep
      step={2}
      title="Altura y peso"
      intro="Los usamos solo para calcular tus metas. Podés cambiarlos cuando quieras."
      submitting={form.submitting}
      formError={form.formError}
      onSubmit={form.submit}
    >
      <Input
        {...form.field("heightCm")}
        label="Altura (cm)"
        placeholder="165"
        keyboardType="number-pad"
        inputMode="numeric"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => weightRef.current?.focus()}
      />
      <Input
        {...form.field("weightKg")}
        ref={weightRef}
        label="Peso (kg)"
        placeholder="60"
        keyboardType="decimal-pad"
        inputMode="decimal"
        returnKeyType="next"
        onSubmitEditing={form.submit}
      />
    </OnboardingStep>
  );
}

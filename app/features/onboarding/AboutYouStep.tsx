import { Redirect, router } from "expo-router";
import { DateField, OptionGroup } from "@/components";
import { useSignUpDraft } from "@/features/auth/sign-up-draft";
import { useForm } from "@/features/auth/useForm";
import { SEX_OPTIONS } from "@/features/profile/options";
import { aboutYouSchema, birthDatePicker } from "@/features/profile/validation";
import { OnboardingStep } from "./OnboardingStep";

export default function AboutYouStep() {
  const draft = useSignUpDraft();
  const form = useForm({
    schema: aboutYouSchema,
    initialValues: { sex: draft.profile.sex, birthDate: draft.profile.birthDate },
    onChange: draft.saveProfile,
    onSubmit: async () => {
      router.push("/onboarding/measures");
    },
  });

  if (!draft.credentials) return <Redirect href="/register" />;

  const sex = form.field("sex");
  const birthDate = form.field("birthDate");

  return (
    <OnboardingStep
      step={1}
      title="Contanos sobre vos"
      intro="Con estos datos estimamos cuánta energía usa tu cuerpo en un día."
      submitting={form.submitting}
      formError={form.formError}
      onSubmit={form.submit}
    >
      <OptionGroup
        label="Sexo"
        hint="Lo usamos solo para la fórmula de gasto de energía."
        options={SEX_OPTIONS}
        value={sex.value}
        onChange={sex.onChangeText}
        error={sex.error}
      />
      <DateField
        label="Fecha de nacimiento"
        {...birthDatePicker()}
        value={birthDate.value}
        onChange={birthDate.onChangeText}
        onBlur={birthDate.onBlur}
        error={birthDate.error}
      />
    </OnboardingStep>
  );
}

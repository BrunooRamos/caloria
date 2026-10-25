import { Redirect } from "expo-router";
import { OptionGroup } from "@/components";
import { useSignUpDraft } from "@/features/auth/sign-up-draft";
import { useForm } from "@/features/auth/useForm";
import { validateForm } from "@/features/auth/validation";
import { ACTIVITY_OPTIONS, GOAL_OPTIONS } from "@/features/profile/options";
import { profileSchema, routineSchema } from "@/features/profile/validation";
import { OnboardingStep } from "./OnboardingStep";

export default function RoutineStep() {
  const draft = useSignUpDraft();
  const form = useForm({
    schema: routineSchema,
    initialValues: { activity: draft.profile.activity, goal: draft.profile.goal },
    onChange: draft.saveProfile,
    onSubmit: async (values) => {
      const profile = validateForm(profileSchema, { ...draft.profile, ...values });
      if (!profile.ok) throw new Error("Falta completar un paso anterior");
      await draft.complete(profile.data);
    },
    messages: {
      VALIDATION_ERROR: "No pudimos crear tu cuenta: revisá los datos de los pasos anteriores.",
    },
  });

  if (!draft.credentials) return <Redirect href="/register" />;

  const activity = form.field("activity");
  const goal = form.field("goal");

  return (
    <OnboardingStep
      step={3}
      title="Tu día a día"
      intro="Elegí lo que más se parece a tu semana y qué querés lograr."
      submitTitle="Crear cuenta"
      submitting={form.submitting}
      formError={form.formError}
      onSubmit={form.submit}
    >
      <OptionGroup
        label="Actividad física"
        options={ACTIVITY_OPTIONS}
        value={activity.value}
        onChange={activity.onChangeText}
        error={activity.error}
        disabled={form.submitting}
      />
      <OptionGroup
        label="Objetivo"
        options={GOAL_OPTIONS}
        value={goal.value}
        onChange={goal.onChangeText}
        error={goal.error}
        disabled={form.submitting}
      />
    </OnboardingStep>
  );
}

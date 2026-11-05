import { usePreventRemove } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { TextInputInstance } from "react-native";
import {
  Button,
  DateField,
  FormError,
  Input,
  OptionGroup,
  Screen,
  Text,
  confirmAction,
  useToast,
} from "@/components";
import { formatNumber } from "@/features/dashboard/format";
import { useForm } from "@/features/auth/useForm";
import { validateForm } from "@/features/auth/validation";
import type { Me } from "@/services/users";
import { spacing } from "@/theme";
import { MeFallback } from "./MeFallback";
import { ACTIVITY_OPTIONS, GOAL_OPTIONS, SEX_OPTIONS } from "./options";
import { useMe } from "./useMe";
import { birthDatePicker, changedFields, profileSchema, profileToValues } from "./validation";
import type { ProfileInput } from "./validation";

/** Tus datos: con lo que se calculan las metas. Al guardar, el Backend las recalcula. */
export default function ProfileDataScreen() {
  const { state, reload, save } = useMe();
  if (state.status !== "ready") {
    return (
      <Screen scroll edges={["bottom", "left", "right"]}>
        <MeFallback state={state} onRetry={reload} />
      </Screen>
    );
  }
  return <ProfileForm me={state.me} save={save} />;
}

interface ProfileFormProps {
  me: Me;
  save(changes: Partial<ProfileInput>): Promise<Me>;
}

function ProfileForm({ me, save }: ProfileFormProps) {
  const weightRef = useRef<TextInputInstance>(null);
  const toast = useToast();
  const [leaving, setLeaving] = useState(false);
  const form = useForm({
    schema: profileSchema,
    initialValues: profileToValues(me.profile),
    onSubmit: async (values) => {
      const changes = changedFields(me.profile, values);
      if (Object.keys(changes).length === 0) return;
      const saved = await save(changes);
      toast(
        `Guardamos tus datos. Tu meta ahora es de ${formatNumber(saved.targets.kcal)} kcal por día.`,
      );
    },
  });

  // Con algún campo inválido el botón queda activo, para que al tocarlo se vean los errores.
  const parsed = validateForm(profileSchema, form.values);
  const dirty = !parsed.ok || Object.keys(changedFields(me.profile, parsed.data)).length > 0;

  // Como al corregir una comida: con cambios sin guardar pregunta antes de salir.
  usePreventRemove((dirty || form.submitting) && !leaving, ({ repeat }) => {
    if (form.submitting) return;
    void confirmAction({
      title: "¿Descartar los cambios?",
      message: "Lo que cambiaste en tus datos no se va a guardar.",
      confirmTitle: "Descartar",
      cancelTitle: "Seguir editando",
    }).then((discard) => {
      if (!discard) return;
      setLeaving(true);
      repeat();
    });
  });

  const sex = form.field("sex");
  const birthDate = form.field("birthDate");
  const activity = form.field("activity");
  const goal = form.field("goal");

  return (
    <Screen
      scroll
      edges={["bottom", "left", "right"]}
      footer={
        <>
          <FormError message={form.formError} />
          <Button
            title="Guardar cambios"
            loading={form.submitting}
            disabled={!dirty}
            onPress={form.submit}
          />
        </>
      }
    >
      <Text color="inkMuted">Si cambiás algo, recalculamos tus metas al guardar.</Text>
      <View style={styles.fields}>
        <OptionGroup
          label="Sexo"
          options={SEX_OPTIONS}
          value={sex.value}
          onChange={sex.onChangeText}
          error={sex.error}
          disabled={form.submitting}
        />
        <DateField
          label="Fecha de nacimiento"
          {...birthDatePicker()}
          value={birthDate.value}
          onChange={birthDate.onChangeText}
          onBlur={birthDate.onBlur}
          error={birthDate.error}
          disabled={form.submitting}
        />
        <Input
          {...form.field("heightCm")}
          label="Altura (cm)"
          keyboardType="number-pad"
          inputMode="numeric"
          editable={!form.submitting}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => weightRef.current?.focus()}
        />
        <Input
          {...form.field("weightKg")}
          ref={weightRef}
          label="Peso (kg)"
          keyboardType="decimal-pad"
          inputMode="decimal"
          editable={!form.submitting}
        />
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
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.xl, marginTop: spacing.xl },
});

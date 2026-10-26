import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { TextInputInstance } from "react-native";
import { Button, DateField, FormError, Input, OptionGroup, Screen, Text } from "@/components";
import { useForm } from "@/features/auth/useForm";
import { validateForm } from "@/features/auth/validation";
import type { Me } from "@/services/users";
import { useSession } from "@/store/session";
import { colors, spacing } from "@/theme";
import { HealthDisclaimer } from "./HealthDisclaimer";
import { MeFallback } from "./MeFallback";
import { ACTIVITY_OPTIONS, GOAL_OPTIONS, SEX_OPTIONS } from "./options";
import { TargetsCard } from "./TargetsCard";
import { useMe } from "./useMe";
import { birthDatePicker, changedFields, profileSchema, profileToValues } from "./validation";
import type { ProfileInput } from "./validation";

export default function ProfileScreen() {
  const { state, reload, save } = useMe();

  return (
    <Screen scroll edges={["bottom", "left", "right"]}>
      {state.status === "ready" ? (
        <ProfileContent me={state.me} save={save} />
      ) : (
        <MeFallback state={state} onRetry={reload} />
      )}
      <View style={styles.spacer} />
      <SignOut />
    </Screen>
  );
}

interface ProfileContentProps {
  me: Me;
  save(changes: Partial<ProfileInput>): Promise<void>;
}

function ProfileContent({ me, save }: ProfileContentProps) {
  const weightRef = useRef<TextInputInstance>(null);
  const [saved, setSaved] = useState(false);
  const form = useForm({
    schema: profileSchema,
    initialValues: profileToValues(me.profile),
    onChange: () => setSaved(false),
    onSubmit: async (values) => {
      const changes = changedFields(me.profile, values);
      if (Object.keys(changes).length === 0) return;
      await save(changes);
      setSaved(true);
    },
  });

  // Con algún campo inválido el botón queda activo, para que al tocarlo se vean los errores.
  const parsed = validateForm(profileSchema, form.values);
  const dirty = !parsed.ok || Object.keys(changedFields(me.profile, parsed.data)).length > 0;
  const sex = form.field("sex");
  const birthDate = form.field("birthDate");
  const activity = form.field("activity");
  const goal = form.field("goal");

  return (
    <>
      <View style={styles.section}>
        <Text variant="h2" accessibilityRole="header">
          Tus metas diarias
        </Text>
        <TargetsCard targets={me.targets} />
        {saved && (
          <Text variant="small" color="sageText" accessibilityLiveRegion="polite">
            Guardamos tus cambios y tus metas ya están actualizadas.
          </Text>
        )}
        <HealthDisclaimer />
      </View>

      <View style={[styles.section, styles.next]}>
        <Text variant="h2" accessibilityRole="header">
          Tus datos
        </Text>
        <Text variant="small" color="inkMuted">
          Si cambiás algo, recalculamos tus metas al guardar.
        </Text>
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
        <FormError message={form.formError} />
        <Button
          title="Guardar cambios"
          loading={form.submitting}
          disabled={!dirty}
          onPress={form.submit}
        />
      </View>
    </>
  );
}

function SignOut() {
  const { signOut } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function confirmSignOut() {
    setSigningOut(true);
    await signOut();
  }

  return (
    <View style={[styles.section, styles.signOut]}>
      {confirming ? (
        <>
          <Text variant="h3" accessibilityRole="header">
            ¿Querés cerrar la sesión?
          </Text>
          <Text color="inkMuted">
            Para volver a entrar vas a necesitar tu email y tu contraseña.
          </Text>
          <View style={styles.actions}>
            <Button
              variant="secondary"
              title="Sí, cerrar sesión"
              loading={signingOut}
              onPress={confirmSignOut}
            />
            <Button
              variant="ghost"
              title="Cancelar"
              disabled={signingOut}
              onPress={() => setConfirming(false)}
            />
          </View>
        </>
      ) : (
        <Button variant="secondary" title="Cerrar sesión" onPress={() => setConfirming(true)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  next: { marginTop: spacing.xl },
  fields: { gap: spacing.xl, marginVertical: spacing.sm },
  spacer: { flexGrow: 1, minHeight: spacing.xl },
  signOut: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.xl,
  },
  actions: { gap: spacing.xs, marginTop: spacing.xs },
});

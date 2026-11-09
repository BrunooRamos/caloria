import { router } from "expo-router";
import { Bell, MessageCircle, Target, UserRoundPen } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button, FormError, ListGroup, ListRow, Screen, Text, confirmAction } from "@/components";
import { formatNumber } from "@/features/dashboard/format";
import { errorMessage } from "@/services/error-messages";
import type { Me } from "@/services/users";
import { useSession } from "@/store/session";
import { colors, spacing } from "@/theme";
import { GOAL_OPTIONS, NOTIFICATION_OPTIONS, TONE_OPTIONS } from "./options";
import { useMe } from "./useMe";

export default function ProfileScreen() {
  const { state, reload } = useMe({ refreshOnFocus: true });
  const me = state.status === "ready" ? state.me : null;

  return (
    <Screen scroll edges={["top", "left", "right"]}>
      <View style={styles.title}>
        <Text variant="h1" accessibilityRole="header">
          Perfil
        </Text>
        {me && <Text color="inkMuted">{me.email}</Text>}
      </View>

      {state.status === "error" && (
        <View style={styles.error}>
          <FormError message={errorMessage(state.error)} />
          <Button variant="secondary" title="Reintentar" onPress={reload} />
        </View>
      )}

      <ListGroup>
        <ListRow
          icon={Target}
          title="Tus metas diarias"
          detail={me ? `${formatNumber(me.targets.kcal)} kcal por día` : undefined}
          onPress={() => router.push("/profile/targets")}
        />
        <ListRow
          icon={UserRoundPen}
          title="Tus datos"
          detail={me ? dataSummary(me) : undefined}
          onPress={() => router.push("/profile/data")}
        />
        <ListRow
          icon={MessageCircle}
          title="Comentario de tus comidas"
          detail={me ? labelOf(TONE_OPTIONS, me.tone) : undefined}
          onPress={() => router.push("/profile/tone")}
        />
        <ListRow
          icon={Bell}
          title="Avisos"
          detail={me ? notificationsSummary(me) : undefined}
          onPress={() => router.push("/profile/notifications")}
        />
      </ListGroup>

      <View style={styles.spacer} />
      <SignOut />
    </Screen>
  );
}

function labelOf<T extends string>(options: { value: T; label: string }[], value: T) {
  return options.find((option) => option.value === value)?.label;
}

/** "60 kg · Mantener mi peso". */
function dataSummary({ profile }: Me) {
  const weight = `${String(profile.weightKg).replace(".", ",")} kg`;
  return [weight, labelOf(GOAL_OPTIONS, profile.goal)].filter(Boolean).join(" · ");
}

/** "Todos activados", "2 de 3 activados", "Todos desactivados". */
function notificationsSummary({ notifications }: Me) {
  const total = NOTIFICATION_OPTIONS.length;
  const on = NOTIFICATION_OPTIONS.filter((option) => notifications[option.value]).length;
  if (on === total) return "Todos activados";
  if (on === 0) return "Todos desactivados";
  return `${on} de ${total} activados`;
}

function SignOut() {
  const { signOut } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  async function confirmSignOut() {
    const confirmed = await confirmAction({
      title: "¿Cerrar la sesión?",
      message: "Para volver a entrar vas a necesitar tu email y tu contraseña.",
      confirmTitle: "Cerrar sesión",
    });
    if (!confirmed) return;
    setSigningOut(true);
    await signOut();
  }

  return (
    <View style={styles.signOut}>
      <Button
        variant="secondary"
        title="Cerrar sesión"
        loading={signingOut}
        onPress={() => void confirmSignOut()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { gap: spacing.xxs, marginBottom: spacing.xl },
  error: { gap: spacing.md, marginBottom: spacing.xl },
  spacer: { flexGrow: 1, minHeight: spacing.xl },
  signOut: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.xl,
  },
});

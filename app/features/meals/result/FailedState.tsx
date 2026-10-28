import { router } from "expo-router";
import { ImageOff, SearchX } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { Button, Card, Text } from "@/components";
import { mealFailureMessage } from "@/services/error-messages";
import { colors, sizes, spacing } from "@/theme";

const goHome = () => router.dismissTo("/");

/** Comida en `failed`: tono tranquilo y una salida clara, sin rojo (no es una alarma). */
export function FailedState({ code }: { code: string }) {
  return (
    <>
      <Notice
        icon={ImageOff}
        title="No pudimos analizar esta foto"
        detail={mealFailureMessage(code)}
      />
      <View style={styles.actions}>
        <Button title="Sacar otra foto" onPress={() => router.replace("/capture")} />
        <Button variant="secondary" title="Volver al inicio" onPress={goHome} />
      </View>
    </>
  );
}

/** 404: la comida no existe o es de otro usuario. */
export function NotFoundState() {
  return (
    <>
      <Notice
        icon={SearchX}
        title="No encontramos esta comida"
        detail="Puede que se haya borrado."
      />
      <Button variant="secondary" title="Volver al inicio" onPress={goHome} />
    </>
  );
}

export function Notice({
  icon: Icon,
  title,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
}) {
  return (
    <Card accessibilityLiveRegion="polite">
      <Icon color={colors.inkMuted} size={sizes.icon} strokeWidth={sizes.iconStroke} />
      <Text variant="h3" accessibilityRole="header">
        {title}
      </Text>
      <Text color="inkMuted">{detail}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm },
});

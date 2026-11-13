import { Dot, Trash } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button, Card, FormError, Input, Screen, Text } from "@/components";
import { isBillingEnabled } from "@/features/billing/billingEnabled";
import { errorMessage } from "@/services/error-messages";
import type { ErrorMessageOverrides } from "@/services/error-messages";
import { useSession } from "@/store/session";
import { colors, sizes, spacing } from "@/theme";
import { useMe } from "./useMe";

/** Lo que hay que escribir para habilitar el botón: más que un toque, para algo que no vuelve. */
export const CONFIRMATION_WORD = "ELIMINAR";

const WHAT_IS_DELETED = [
  "Tu perfil, tus datos y tus metas diarias.",
  "Todas tus comidas, con sus fotos, audios y comentarios.",
  "Tus resúmenes semanales y tu racha.",
];

const DELETE_ERRORS: ErrorMessageOverrides = {
  // La respuesta se pudo haber perdido después de borrar: reintentar lo confirma igual.
  NETWORK_ERROR: "No pudimos confirmar que se eliminó: revisá tu conexión y probá de nuevo.",
  SERVICE_UNAVAILABLE: "No pudimos eliminar tu cuenta ahora. Probá de nuevo en unos minutos.",
};

/**
 * Eliminar la cuenta: qué se borra, que no se puede recuperar y la palabra para
 * confirmar. Si el pedido falla, la sesión sigue como estaba y se reintenta con el mismo botón.
 */
export default function DeleteAccountScreen() {
  const { deleteAccount } = useSession();
  const { state } = useMe();
  // Sin pagos (build de Google Play) no se habla de la suscripción.
  const premium =
    isBillingEnabled() && state.status === "ready" && state.me.plan.tier === "premium";
  const [word, setWord] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = word.trim().toUpperCase() === CONFIRMATION_WORD;

  async function submit() {
    if (!confirmed || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      // Sin sesión, la navegación lleva al login y esta pantalla se desmonta.
      await deleteAccount();
    } catch (err) {
      setError(errorMessage(err, DELETE_ERRORS));
      setDeleting(false);
    }
  }

  return (
    <Screen scroll edges={["bottom", "left", "right"]}>
      <View style={styles.content}>
        <Text>Se borra tu cuenta y todo lo que guardaste en CalorIA.</Text>
        <Card>
          <Text variant="h3" accessibilityRole="header">
            Qué se borra
          </Text>
          <View style={styles.list}>
            {WHAT_IS_DELETED.map((item) => (
              <View key={item} style={styles.item}>
                <Dot
                  color={colors.inkMuted}
                  size={sizes.icon}
                  strokeWidth={sizes.iconStroke}
                  accessible={false}
                />
                <Text style={styles.itemText}>{item}</Text>
              </View>
            ))}
          </View>
          {premium && (
            <Text>
              Tu suscripción premium termina en el momento: no se te cobra más y no se devuelve lo
              que quedaba del período.
            </Text>
          )}
        </Card>
        <Text variant="bodyStrong">No se puede deshacer ni recuperar.</Text>

        <View style={styles.confirm}>
          <Input
            label={`Para confirmar, escribí ${CONFIRMATION_WORD}`}
            value={word}
            onChangeText={setWord}
            editable={!deleting}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
          />
          <FormError message={error} />
          <Button
            variant="destructive"
            icon={Trash}
            title="Eliminar mi cuenta"
            disabled={!confirmed}
            loading={deleting}
            onPress={() => void submit()}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.xl },
  list: { gap: spacing.xs },
  item: { flexDirection: "row", alignItems: "flex-start" },
  itemText: { flex: 1 },
  confirm: { gap: spacing.md, marginTop: spacing.xs },
});

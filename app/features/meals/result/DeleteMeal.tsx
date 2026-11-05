import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button, FormError, confirmAction, goBack, useToast } from "@/components";
import { ApiError } from "@/services/api-error";
import { errorMessage } from "@/services/error-messages";
import { deleteMeal } from "@/services/meals";
import { spacing } from "@/theme";

/**
 * "Eliminar comida" al final del detalle: pide confirmación, avisa que salió bien y vuelve. Un 404
 * cuenta como borrada (ya no estaba). El inicio y el historial la sacan al volver a tener el foco.
 */
export function DeleteMeal({ id }: { id: string }) {
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function remove() {
    const confirmed = await confirmAction({
      title: "¿Eliminar esta comida?",
      message: "Se borra con su foto y deja de sumar en el día. No se puede deshacer.",
      confirmTitle: "Eliminar",
    });
    if (!confirmed) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteMeal(id);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        setError(err);
        setDeleting(false);
        return;
      }
    }
    toast("Eliminamos la comida.");
    goBack();
  }

  return (
    <View style={styles.root}>
      <FormError message={error === null ? null : errorMessage(error)} />
      <Button
        variant="ghost"
        title="Eliminar comida"
        loading={deleting}
        onPress={() => void remove()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs },
});

import { CameraOff, X } from "lucide-react-native";
import { Linking, StyleSheet, View } from "react-native";
import { Button, HeaderButton, Screen, Text } from "@/components";
import { colors, sizes, spacing } from "@/theme";

export interface PermissionStepProps {
  /** `false` si el sistema ya no vuelve a preguntar: solo queda la configuración. */
  canAskAgain: boolean;
  onRequest(): void;
  onPickFromGallery(): void;
  onClose(): void;
}

/** Permiso de cámara negado: explica para qué se usa y deja seguir por la galería o cerrar. */
export function PermissionStep({
  canAskAgain,
  onRequest,
  onPickFromGallery,
  onClose,
}: PermissionStepProps) {
  return (
    <Screen>
      <View style={styles.close}>
        <HeaderButton icon={X} title="Cerrar" onPress={onClose} />
      </View>
      <View style={styles.content}>
        <CameraOff color={colors.primary} size={sizes.icon} strokeWidth={sizes.iconStroke} />
        <Text variant="h1" accessibilityRole="header">
          Necesitamos tu cámara
        </Text>
        <Text color="inkMuted">
          La usamos solo para sacarle una foto a tu comida y estimar sus calorías y macros.
        </Text>
        {!canAskAgain && (
          <Text variant="small" color="inkMuted">
            Podés activarla en la configuración del sistema, en los permisos de CalorIA.
          </Text>
        )}
      </View>
      <View style={styles.actions}>
        {canAskAgain ? (
          <Button title="Permitir cámara" onPress={onRequest} />
        ) : (
          <Button title="Abrir configuración" onPress={() => void Linking.openSettings()} />
        )}
        <Button variant="secondary" title="Elegir de la galería" onPress={onPickFromGallery} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  close: { marginTop: spacing.xs - spacing.xl },
  content: { flex: 1, justifyContent: "center", gap: spacing.sm },
  actions: { gap: spacing.sm },
});

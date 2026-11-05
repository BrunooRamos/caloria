import { Image, Modal, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Button, Screen, Text } from "@/components";
import { useReduceMotion } from "@/components/useReduceMotion";
import { borderWidth, colors, radius, sizes, spacing } from "@/theme";
import type { WrappedCard } from "./cards";

export interface SharePreviewProps {
  card: WrappedCard;
  uri: string;
  sharing: boolean;
  onShare: () => void;
  onCancel: () => void;
}

const ASPECT = sizes.shareImage.width / sizes.shareImage.height;

export function SharePreview({ card, uri, sharing, onShare, onCancel }: SharePreviewProps) {
  const reduceMotion = useReduceMotion();
  if (reduceMotion === null) return null;
  return (
    <Modal
      visible
      animationType={reduceMotion ? "none" : "slide"}
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onCancel}
    >
      <SafeAreaProvider>
        <Screen>
          <View style={styles.root}>
            <View style={styles.header}>
              <Text variant="h1" accessibilityRole="header">
                Vista previa
              </Text>
              <Text color="inkMuted">
                Así se va a ver la imagen. Cualquiera que la reciba va a poder ver lo que muestra.
              </Text>
            </View>
            <View style={styles.imageArea}>
              <Image
                source={{ uri }}
                style={styles.image}
                resizeMode="contain"
                accessible
                accessibilityRole="image"
                accessibilityLabel={`Imagen para compartir. ${card.accessibilityLabel}`}
              />
            </View>
            <View style={styles.actions}>
              <Button title="Compartir" loading={sharing} onPress={onShare} />
              <Button variant="ghost" title="Cancelar" disabled={sharing} onPress={onCancel} />
            </View>
          </View>
        </Screen>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: spacing.lg },
  header: { gap: spacing.xs },
  imageArea: { flex: 1, alignItems: "center", justifyContent: "center" },
  image: {
    height: "100%",
    maxWidth: "100%",
    aspectRatio: ASPECT,
    borderRadius: radius.lg,
    borderWidth: borderWidth.default,
    borderColor: colors.border,
  },
  actions: { gap: spacing.sm },
});

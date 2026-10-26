import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Image, StyleSheet, View } from "react-native";
import { Card, Screen, Text } from "@/components";
import { colors, radius, spacing } from "@/theme";

/**
 * Resultado de una comida, por ahora mínimo: la foto recién subida y el estado "analizando".
 * El polling de `GET /meals/:id` y el análisis completo van en otro ticket.
 */
export default function MealResultScreen() {
  const { photoUri } = useLocalSearchParams<{ id: string; photoUri?: string }>();
  // Solo la foto local que dejó la captura; un link no puede hacer cargar una URL cualquiera.
  const localPhoto = photoUri?.startsWith("file:") ? photoUri : undefined;

  return (
    <Screen edges={["bottom", "left", "right"]}>
      <View style={styles.content}>
        {localPhoto ? (
          <Image
            source={{ uri: localPhoto }}
            resizeMode="cover"
            accessibilityLabel="Foto de tu comida"
            style={styles.photo}
          />
        ) : (
          <View style={styles.photo} />
        )}
        <Card accessibilityLiveRegion="polite">
          <View style={styles.status}>
            <ActivityIndicator color={colors.primary} />
            <Text variant="h3">Analizando tu comida…</Text>
          </View>
          <Text variant="small" color="inkMuted">
            Estimamos las calorías y los macros a partir de la foto. Tarda unos segundos.
          </Text>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl },
  photo: { aspectRatio: 4 / 3, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt },
  status: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});

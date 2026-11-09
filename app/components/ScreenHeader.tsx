import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "@/theme";
import { HEADER_MAX_FONT_SCALE, HeaderButton } from "./HeaderButton";
import { Text } from "./Text";

export interface ScreenHeaderProps {
  title: string;
}

/**
 * Volver a donde estaba; si la pantalla se abrió sola (un link directo), al inicio. El atrás de
 * Android y el gesto de iOS hacen lo mismo: debajo siempre quedan las pestañas.
 */
export function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

/** Al inicio, cerrando lo que haya encima de las pestañas. */
export function goHome() {
  router.dismissTo("/");
}

/**
 * Header de las pantallas de detalle: "‹ Volver" arriba a la izquierda y, debajo, el título en `h2`
 * (negrita), alineado con el contenido. Va en el `header` del Stack, así todas lo tienen igual; un
 * título largo baja de línea en vez de cortarse.
 */
export function ScreenHeader({ title }: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right },
      ]}
    >
      <View style={styles.back}>
        <HeaderButton icon={ChevronLeft} title="Volver" onPress={goBack} />
      </View>
      <Text
        variant="h2"
        accessibilityRole="header"
        maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}
        style={styles.title}
      >
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background },
  back: { paddingHorizontal: spacing.lg - spacing.xs, paddingTop: spacing.xxs },
  title: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
});

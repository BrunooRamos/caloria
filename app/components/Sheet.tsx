import { useEffect, useState } from "react";
import type { PropsWithChildren } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, motion, radius, shadow, spacing } from "@/theme";
import { useReduceMotion } from "./useReduceMotion";

export interface SheetProps extends PropsWithChildren {
  visible: boolean;
  /** Tocar afuera, el atrás de Android o el gesto de escape de VoiceOver. */
  onClose: () => void;
}

/**
 * Hoja que sube desde abajo, encima de todo, para un aviso con acciones de la app (el cupo de
 * análisis, por ejemplo). Confirmar que se borra o descarta algo no va acá: eso es `confirmAction`,
 * el diálogo del sistema. Mientras está abierta, el lector de pantalla queda adentro.
 */
export function Sheet({ visible, onClose, children }: SheetProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [entered] = useState(() => new Animated.Value(0));
  const animate = reduceMotion === false;

  useEffect(() => {
    if (!visible) return;
    if (!animate) {
      entered.setValue(1);
      return;
    }
    entered.setValue(0);
    Animated.timing(entered, {
      toValue: 1,
      duration: motion.enter,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [animate, entered, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={animate ? "fade" : "none"}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        {/* Tocar afuera cierra; para el lector de pantalla ya están los botones de la hoja. */}
        <Pressable
          testID="sheet-backdrop"
          style={styles.backdrop}
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
        />
        <Animated.View
          testID="sheet"
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={[
            styles.sheet,
            {
              paddingBottom: insets.bottom + spacing.lg,
              transform: [
                {
                  translateY: entered.interpolate({
                    inputRange: [0, 1],
                    outputRange: [motion.enterOffset, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {/* Con la fuente del sistema muy grande, se desplaza en vez de tapar los botones. */}
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} bounces={false}>
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim },
  sheet: {
    maxHeight: "90%",
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    ...shadow.float,
  },
  scroll: { flexGrow: 0 },
  content: { gap: spacing.sm },
});

import { CircleCheck } from "lucide-react-native";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { PropsWithChildren } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, motion, radius, shadow, sizes, spacing } from "@/theme";
import { Text } from "./Text";
import { useReduceMotion } from "./useReduceMotion";

type ShowToast = (message: string) => void;

const ToastContext = createContext<ShowToast>(() => undefined);

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

/**
 * Avisos breves, uno por vez, encima de la barra de pestañas. Duran `motion.toast`, no se tocan
 * (los toques pasan a lo de abajo) y el lector de pantalla los anuncia una vez. Va arriba de la navegación,
 * así el aviso sigue visible después de volver de pantalla.
 */
export function ToastProvider({ children }: PropsWithChildren) {
  const [toast, setToast] = useState<{ key: number; message: string } | null>(null);
  const count = useRef(0);

  const show = useCallback<ShowToast>((message) => {
    count.current += 1;
    setToast({ key: count.current, message });
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(message);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), motion.toast);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext value={show}>
      {children}
      {toast && <ToastView key={toast.key} message={toast.message} />}
    </ToastContext>
  );
}

function ToastView({ message }: { message: string }) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [entered] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduceMotion === null) return;
    if (reduceMotion) {
      entered.setValue(1);
      return;
    }
    Animated.timing(entered, {
      toValue: 1,
      duration: motion.enter,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entered, reduceMotion]);

  return (
    <Animated.View
      testID="toast"
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        {
          bottom: insets.bottom + sizes.tabBar + spacing.sm,
          opacity: entered,
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
      <CircleCheck color={colors.onPrimary} size={sizes.icon} strokeWidth={sizes.iconStroke} />
      <Text variant="bodyStrong" color="onPrimary" style={styles.message}>
        {message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    pointerEvents: "none",
    ...shadow.float,
  },
  message: { flexShrink: 1 },
});

import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet } from "react-native";
import type { DimensionValue } from "react-native";
import { colors, motion, opacity, radius } from "@/theme";
import { useReduceMotion } from "./useReduceMotion";

export interface SkeletonProps {
  height: number;
  width?: DimensionValue;
  rounded?: keyof typeof radius;
}

export function Skeleton({ height, width = "100%", rounded = "sm" }: SkeletonProps) {
  const reduceMotion = useReduceMotion();
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(1);
      return;
    }
    const step = (toValue: number) =>
      Animated.timing(pulse, {
        toValue,
        duration: motion.skeletonPulse,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      });
    const loop = Animated.loop(Animated.sequence([step(opacity.skeleton), step(1)]));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.base, { height, width, borderRadius: radius[rounded], opacity: pulse }]}
    />
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.surfaceAlt },
});

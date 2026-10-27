import { StyleSheet, View } from "react-native";
import { colors, radius, sizes } from "@/theme";

export interface ProgressBarProps {
  /** De 0 a 1; lo que se pasa de 1 deja la barra llena, en el mismo color (RNF-10). */
  progress: number;
  size?: "regular" | "large";
}

/** Solo dibuja: el valor para el lector de pantalla lo pone quien la usa, con su texto. */
export function ProgressBar({ progress, size = "regular" }: ProgressBarProps) {
  const fill = Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0;
  const height = size === "large" ? sizes.progressLarge : sizes.progress;
  return (
    <View
      testID="progress-track"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.track, { height }]}
    >
      <View testID="progress-fill" style={[styles.fill, { width: `${fill * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { backgroundColor: colors.surfaceAlt, borderRadius: radius.full, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.primary, borderRadius: radius.full },
});

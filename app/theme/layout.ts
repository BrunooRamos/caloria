import type { ViewStyle } from "react-native";
import { colors } from "./colors";

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** Skill §4. */
export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  xl: 28,
  full: 999,
} as const;

export const borderWidth = {
  default: 1,
  focus: 2,
  error: 1.5,
  shutter: 4,
} as const;

export const sizes = {
  control: 52,
  touchTarget: 44,
  icon: 24,
  iconDense: 20,
  iconStroke: 2,
  iconStrokeLight: 1.75,
  logo: { width: 160 },
  fab: 64,
  shutter: 72,
  /** Alto de la ProgressBar (skill §5) y de la principal del dashboard, que es más grande. */
  progress: 10,
  progressLarge: 16,
} as const;

export const opacity = {
  pressed: 0.85,
  disabled: 0.4,
  skeleton: 0.5,
} as const;

export const motion = {
  skeletonPulse: 900,
} as const;

export const shadow = {
  float: {
    shadowColor: colors.primary,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
} as const satisfies Record<string, ViewStyle>;

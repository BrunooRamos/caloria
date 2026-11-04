import type { TextStyle } from "react-native";
import telegrafRegular from "@/assets/fonts/Telegraf-Regular.otf";
import telegrafUltraBold from "@/assets/fonts/Telegraf-UltraBold.otf";

export const fontFiles = {
  "Telegraf-Regular": telegrafRegular,
  "Telegraf-UltraBold": telegrafUltraBold,
} as const;

type FontFamily = keyof typeof fontFiles;

export const fonts = {
  regular: { fontFamily: "Telegraf-Regular" },
  medium: { fontFamily: "Telegraf-Regular" },
  bold: { fontFamily: "Telegraf-UltraBold" },
} as const satisfies Record<string, { fontFamily: FontFamily }>;

export const typography = {
  display: { ...fonts.bold, fontSize: 40, lineHeight: 44, letterSpacing: -0.5 },
  h1: { ...fonts.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.3 },
  h2: { ...fonts.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.2 },
  h3: { ...fonts.medium, fontSize: 18, lineHeight: 24, letterSpacing: 0 },
  body: { ...fonts.regular, fontSize: 16, lineHeight: 24, letterSpacing: 0 },
  bodyStrong: { ...fonts.medium, fontSize: 16, lineHeight: 24, letterSpacing: 0 },
  label: { ...fonts.medium, fontSize: 16, lineHeight: 20, letterSpacing: 0.1 },
  small: { ...fonts.regular, fontSize: 14, lineHeight: 20, letterSpacing: 0 },
  smallStrong: { ...fonts.medium, fontSize: 14, lineHeight: 20, letterSpacing: 0 },
  caption: { ...fonts.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0.3 },
} as const satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof typography;

export const maxFontSizeMultiplier: Partial<Record<TextVariant, number>> = {
  display: 1.3,
  h1: 1.3,
};

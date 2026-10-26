import { Text as NativeText } from "react-native";
import type { TextProps as NativeTextProps } from "react-native";
import { colors, maxFontSizeMultiplier, typography } from "@/theme";
import type { ColorToken, TextVariant } from "@/theme";
import { useTone } from "./tone";
import type { SurfaceTone } from "./tone";

export interface TextProps extends NativeTextProps {
  variant?: TextVariant;
  color?: ColorToken;
}

const HEADINGS: ReadonlySet<TextVariant> = new Set(["display", "h1", "h2", "h3"]);

const headingColors: Record<SurfaceTone, ColorToken> = { default: "primary", brand: "cream" };

export function Text({ variant = "body", color, style, ...props }: TextProps) {
  const tone = useTone();
  const resolved = color ?? (HEADINGS.has(variant) ? headingColors[tone] : "ink");
  return (
    <NativeText
      maxFontSizeMultiplier={maxFontSizeMultiplier[variant]}
      {...props}
      style={[typography[variant], { color: colors[resolved] }, style]}
    />
  );
}

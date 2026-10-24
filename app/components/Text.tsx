import { Text as NativeText } from "react-native";
import type { TextProps as NativeTextProps } from "react-native";
import { colors, maxFontSizeMultiplier, typography } from "@/theme";
import type { ColorToken, TextVariant } from "@/theme";

export interface TextProps extends NativeTextProps {
  variant?: TextVariant;
  color?: ColorToken;
}

export function Text({ variant = "body", color = "ink", style, ...props }: TextProps) {
  return (
    <NativeText
      maxFontSizeMultiplier={maxFontSizeMultiplier[variant]}
      {...props}
      style={[typography[variant], { color: colors[color] }, style]}
    />
  );
}

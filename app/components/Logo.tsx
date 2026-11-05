import { Image, View } from "react-native";
import logoColor from "@/assets/logo/logo-color.png";
import logoCream from "@/assets/logo/logo-cream.png";
import { sizes } from "@/theme";

const ASSET = { width: 847, height: 765, flameWidth: 345 } as const;

export type LogoVariant = "cream" | "color";

const SOURCES = { cream: logoCream, color: logoColor } as const;

export interface LogoProps {
  width?: number;
  variant?: LogoVariant;
  onLoad?: () => void;
}

export function Logo({ width = sizes.logo.width, variant = "cream", onLoad }: LogoProps) {
  const clearSpace = (width * ASSET.flameWidth) / ASSET.width / 2;
  return (
    <View style={{ padding: clearSpace }}>
      <Image
        source={SOURCES[variant]}
        style={{ width, height: (width * ASSET.height) / ASSET.width }}
        resizeMode="contain"
        onLoad={onLoad}
        accessible
        accessibilityRole="image"
        accessibilityLabel="CalorIA"
      />
    </View>
  );
}

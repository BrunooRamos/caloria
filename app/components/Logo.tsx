import { Image, StyleSheet, View } from "react-native";
import logoCream from "@/assets/logo/logo-cream.png";
import { sizes } from "@/theme";

const ASSET = { width: 847, height: 765, flameWidth: 345 } as const;

const width = sizes.logo.width;
const clearSpace = (width * ASSET.flameWidth) / ASSET.width / 2;

export function Logo() {
  return (
    <View style={styles.clearSpace}>
      <Image
        source={logoCream}
        style={styles.image}
        resizeMode="contain"
        accessible
        accessibilityRole="image"
        accessibilityLabel="CalorIA"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  clearSpace: { padding: clearSpace },
  image: { width, height: (width * ASSET.height) / ASSET.width },
});

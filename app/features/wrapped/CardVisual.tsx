import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import { borderWidth, colors, radius, spacing } from "@/theme";
import { CardArt } from "./CardArt";
import type { WrappedCard } from "./cards";

export interface CardVisualProps {
  card: WrappedCard;
  onSettled?: () => void;
}

const PLATE_FILL = 0.84;

export function CardVisual({ card, onSettled }: CardVisualProps) {
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState(0);

  if (!card.photoUrl || failed) return <CardArt kind={card.kind} filled={card.filled} />;

  const onLayout = ({ nativeEvent: { layout } }: LayoutChangeEvent) =>
    setSize(Math.min(layout.width, layout.height) * PLATE_FILL);

  return (
    <View
      style={styles.root}
      onLayout={onLayout}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <View style={[styles.ring, { width: size, height: size }]}>
        <Image
          testID="dish-photo"
          source={{ uri: card.photoUrl }}
          style={styles.photo}
          resizeMode="cover"
          onLoad={onSettled}
          onError={() => {
            setFailed(true);
            onSettled?.();
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center" },
  ring: {
    borderRadius: radius.full,
    borderWidth: borderWidth.artRing,
    borderColor: colors.sage,
    padding: spacing.xs,
  },
  photo: {
    flex: 1,
    borderRadius: radius.full,
    backgroundColor: colors.sage,
  },
});

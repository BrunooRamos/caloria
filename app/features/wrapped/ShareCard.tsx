import { useEffect, useRef, useState } from "react";
import type { Ref } from "react";
import { PixelRatio, StyleSheet, View } from "react-native";
import type { LayoutChangeEvent, ViewInstance } from "react-native";
import { Logo, Text } from "@/components";
import { colors, sizes, spacing } from "@/theme";
import { CardBody } from "./CardBody";
import { CardVisual } from "./CardVisual";
import type { WrappedCard } from "./cards";

export interface ShareCardProps {
  ref: Ref<ViewInstance>;
  card: WrappedCard;
  weekLabel: string;
  onReady: () => void;
}

const { width: CANVAS_W, height: CANVAS_H } = sizes.shareCanvas;
const { width: IMAGE_W, height: IMAGE_H } = sizes.shareImage;

const heightOf = (event: LayoutChangeEvent) => event.nativeEvent.layout.height;

export function ShareCard({ ref, card, weekLabel, onReady }: ShareCardProps) {
  const [laidOut, setLaidOut] = useState(false);
  const [logoLoaded, setLogoLoaded] = useState(false);
  const [photoSettled, setPhotoSettled] = useState(!card.photoUrl);
  const [areaHeight, setAreaHeight] = useState(0);
  const [textHeight, setTextHeight] = useState(0);
  const notified = useRef(false);

  const measured = areaHeight > 0 && textHeight > 0;
  const scale = measured ? Math.min(1, areaHeight / textHeight) : 1;

  useEffect(() => {
    if (!laidOut || !logoLoaded || !photoSettled || !measured || notified.current) return;
    notified.current = true;
    onReady();
  }, [laidOut, logoLoaded, photoSettled, measured, onReady]);

  const width = IMAGE_W / PixelRatio.get();
  const height = IMAGE_H / PixelRatio.get();

  return (
    <View
      ref={ref}
      testID="share-card"
      collapsable={false}
      onLayout={() => setLaidOut(true)}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.host, { width, height, left: -width }]}
    >
      <View style={[styles.canvas, { transform: [{ scale: width / CANVAS_W }] }]}>
        <View>
          <Text variant="small" color="onPrimaryMuted" allowFontScaling={false}>
            Mi semana
          </Text>
          <Text variant="bodyStrong" color="cream" allowFontScaling={false}>
            {weekLabel}
          </Text>
        </View>
        <View
          testID="share-card-area"
          style={styles.area}
          onLayout={(event) => setAreaHeight(heightOf(event))}
        >
          <View style={styles.visual}>
            <CardVisual card={card} onSettled={() => setPhotoSettled(true)} />
          </View>
          <View
            testID="share-card-text"
            onLayout={(event) => setTextHeight(heightOf(event))}
            style={[styles.text, scale < 1 && { transform: [{ scale }] }]}
          >
            <CardBody card={card} allowFontScaling={false} />
          </View>
        </View>
        <View style={styles.logo}>
          <Logo width={sizes.logo.shareWidth} onLoad={() => setLogoLoaded(true)} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 0,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: colors.primary,
  },
  canvas: {
    width: CANVAS_W,
    height: CANVAS_H,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    gap: spacing.md,
  },
  area: { flex: 1, justifyContent: "flex-end", gap: spacing.md },
  visual: { flex: 1, marginHorizontal: -spacing.xl },
  text: { flexShrink: 0, transformOrigin: "left bottom" },
  logo: { alignItems: "center" },
});

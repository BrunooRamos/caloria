import { useEffect, useRef, useState } from "react";
import { Animated, Easing, ScrollView, StyleSheet, View } from "react-native";
import { useReduceMotion } from "@/components/useReduceMotion";
import { colors, motion, radius, spacing } from "@/theme";
import { CardBody } from "./CardBody";
import { CardVisual } from "./CardVisual";
import type { WrappedCard } from "./cards";

export interface WrappedCardViewProps {
  card: WrappedCard;
  position: string;
  active: boolean;
}

export function WrappedCardView({ card, position, active }: WrappedCardViewProps) {
  const reduceMotion = useReduceMotion();
  const [entered] = useState(() => new Animated.Value(0));
  const seen = useRef(false);

  useEffect(() => {
    if (!active || seen.current) return;
    seen.current = true;
    if (reduceMotion) {
      entered.setValue(1);
      return;
    }
    Animated.timing(entered, {
      toValue: 1,
      duration: motion.enter,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [active, reduceMotion, entered]);

  const progress = reduceMotion ? 1 : entered;
  const enterStyle = {
    opacity: progress,
    transform: [
      {
        translateY:
          typeof progress === "number"
            ? 0
            : progress.interpolate({ inputRange: [0, 1], outputRange: [motion.enterOffset, 0] }),
      },
    ],
  };

  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`${card.accessibilityLabel} ${position}.`}
    >
      <View style={styles.art}>
        <CardVisual card={card} />
      </View>
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={enterStyle}>
          <CardBody card={card} />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    overflow: "hidden",
  },
  art: { flex: 1 },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    paddingTop: spacing.md,
  },
});

import { StyleSheet, View } from "react-native";
import { Text } from "@/components";
import type { TextVariant } from "@/theme";
import { colors, radius, spacing } from "@/theme";
import type { WrappedCard } from "./cards";

export interface CardBodyProps {
  card: WrappedCard;
  allowFontScaling?: boolean;
  itemVariant?: TextVariant;
}

export function CardBody({ card, allowFontScaling = true, itemVariant = "h3" }: CardBodyProps) {
  const scaling = { allowFontScaling };
  return (
    <View style={styles.root}>
      <Text variant="h3" color="onPrimaryMuted" {...scaling}>
        {card.eyebrow}
      </Text>
      {card.hero !== undefined && (
        <View style={styles.hero}>
          <Text variant={card.kind === "topDish" ? "h1" : "display"} color="cream" {...scaling}>
            {card.hero}
          </Text>
          {card.unit && (
            <Text variant="h3" color="cream" {...scaling}>
              {card.unit}
            </Text>
          )}
        </View>
      )}
      {card.detail && (
        <Text color="onPrimaryMuted" {...scaling}>
          {card.detail}
        </Text>
      )}
      {card.items && (
        <View style={styles.items}>
          {card.items.map((item, index) => (
            <View key={index} style={styles.item}>
              <View style={styles.bullet} />
              <Text variant={itemVariant} color="cream" style={styles.itemText} {...scaling}>
                {item}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs },
  hero: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: spacing.xs,
  },
  items: { gap: spacing.md, paddingTop: spacing.xs },
  item: { flexDirection: "row", gap: spacing.sm },
  bullet: {
    width: spacing.xs,
    height: spacing.xs,
    marginTop: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.sage,
  },
  itemText: { flex: 1 },
});

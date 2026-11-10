import { router, useLocalSearchParams } from "expo-router";
import { CalendarClock, Sparkles } from "lucide-react-native";
import { memo, useCallback, useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import type { LayoutChangeEvent, ListRenderItem, ListViewToken } from "react-native";
import { Button, FormError, Notice, Screen, Skeleton, Text } from "@/components";
import { deviceTimeZone } from "@/features/profile/timezone";
import { todayIn } from "@/features/history/day";
import { errorMessage } from "@/services/error-messages";
import type { WeeklySummary } from "@/services/summaries";
import { colors, radius, sizes, spacing } from "@/theme";
import { wrappedCards } from "./cards";
import type { WrappedCard } from "./cards";
import { SharePreview } from "./SharePreview";
import { ShareCard } from "./ShareCard";
import { useCardShare } from "./useCardShare";
import { useWeeklySummary } from "./useWeeklySummary";
import { resolveWeek, weekLabel } from "./week";
import { WrappedCardView } from "./WrappedCardView";

/**
 * El Wrapped semanal. Sin semana en la ruta es la pestaña "Semana" (la última semana
 * completa) y lleva su propio título; con semana (`/wrapped/2026-W43`, como la abre el aviso) es una
 * pantalla de detalle con el header común.
 */
export default function WrappedScreen() {
  const params = useLocalSearchParams<{ week?: string }>();
  const [timeZone] = useState(deviceTimeZone);
  const week = resolveWeek(params.week, todayIn(timeZone));
  return <WeekView key={week} week={week} tab={params.week === undefined} />;
}

function WeekView({ week, tab }: { week: string; tab: boolean }) {
  const { state, reload } = useWeeklySummary(week);
  const label = weekLabel(week);

  let body;
  if (state.status === "loading") {
    body = (
      <View style={styles.fill} accessible accessibilityLabel="Cargando tu semana">
        <Skeleton height="100%" rounded="xl" />
      </View>
    );
  } else if (state.status === "ready") {
    body = <Cards summary={state.summary} week={week} label={label} />;
  } else if (state.status === "unavailable") {
    body = (
      <>
        <Notice
          icon={CalendarClock}
          title="Todavía no hay resumen de esta semana"
          detail="Se arma los lunes a la mañana con lo que registraste la semana anterior. Si esa semana no registraste comidas, no hay resumen."
        >
          <Button variant="secondary" title="Actualizar" onPress={reload} />
        </Notice>
      </>
    );
  } else if (state.status === "premiumRequired") {
    body = <PremiumRequiredState />;
  } else {
    body = (
      <View style={styles.actions}>
        <FormError message={errorMessage(state.error)} />
        <Button variant="secondary" title="Reintentar" onPress={reload} />
      </View>
    );
  }

  return (
    <Screen edges={tab ? ["top", "left", "right"] : ["bottom", "left", "right"]}>
      <View style={styles.root}>
        {/* Como detalle, "Tu semana" va en el header común; la semana, siempre como subtítulo. */}
        <View style={styles.title}>
          {tab && (
            <Text variant="h1" accessibilityRole="header">
              Tu semana
            </Text>
          )}
          <Text color="inkMuted">{label}</Text>
        </View>
        {body}
      </View>
    </Screen>
  );
}

function Cards({ summary, week, label }: { summary: WeeklySummary; week: string; label: string }) {
  const cards = useMemo(() => wrappedCards(summary), [summary]);
  const [pageWidth, setPageWidth] = useState(0);
  const [active, setActive] = useState(0);
  const { state: share, shareCardRef, start, capture, cancel, share: confirm } = useCardShare(week);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setPageWidth(event.nativeEvent.layout.width);
  }, []);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ListViewToken[] }) => {
      const index = viewableItems[0]?.index;
      if (typeof index === "number") setActive(index);
    },
    [],
  );

  const busy = share.status !== "idle";
  const capturingKey = share.status === "capturing" ? share.card.key : null;
  const renderItem: ListRenderItem<WrappedCard> = ({ item, index }) => (
    <CardPage
      card={item}
      index={index}
      total={cards.length}
      width={pageWidth}
      active={index === active}
      capturing={capturingKey === item.key}
      busy={busy}
      onShare={start}
    />
  );

  return (
    <>
      <Indicator count={cards.length} active={active} />
      <View style={styles.fill} onLayout={onLayout} testID="wrapped-pager">
        {pageWidth > 0 && (
          <FlatList
            data={cards}
            keyExtractor={(card) => card.key}
            renderItem={renderItem}
            extraData={`${active}-${capturingKey}-${busy}`}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            getItemLayout={(_, index) => ({
              length: pageWidth,
              offset: pageWidth * index,
              index,
            })}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={VIEWABILITY}
          />
        )}
      </View>
      {share.status === "idle" && <FormError message={share.error} />}
      {share.status === "capturing" && (
        <ShareCard
          key={share.card.key}
          ref={shareCardRef}
          card={share.card}
          weekLabel={label}
          onReady={capture}
        />
      )}
      {(share.status === "preview" || share.status === "sharing") && (
        <SharePreview
          card={share.card}
          uri={share.uri}
          sharing={share.status === "sharing"}
          onShare={confirm}
          onCancel={cancel}
        />
      )}
    </>
  );
}

const VIEWABILITY = { itemVisiblePercentThreshold: 60 };

interface CardPageProps {
  card: WrappedCard;
  index: number;
  total: number;
  width: number;
  active: boolean;
  capturing: boolean;
  busy: boolean;
  onShare: (card: WrappedCard) => void;
}

const CardPage = memo(function CardPage({
  card,
  index,
  total,
  width,
  active,
  capturing,
  busy,
  onShare,
}: CardPageProps) {
  return (
    <View style={[styles.page, { width }]}>
      <WrappedCardView card={card} position={`Tarjeta ${index + 1} de ${total}`} active={active} />
      <Button
        variant="secondary"
        title="Compartir"
        accessibilityLabel={`Compartir tarjeta ${index + 1}`}
        loading={capturing}
        disabled={busy}
        onPress={() => onShare(card)}
      />
    </View>
  );
});

function Indicator({ count, active }: { count: number; active: number }) {
  return (
    <View
      style={styles.indicator}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={[styles.segment, index <= active ? styles.segmentDone : styles.segmentRest]}
        />
      ))}
    </View>
  );
}

function PremiumRequiredState() {
  return (
    <Notice
      icon={Sparkles}
      title="El resumen semanal es parte de premium"
      detail="Lo incluye el plan premium. Tus registros de la semana siguen guardados."
    >
      <Button variant="secondary" title="Ver planes" onPress={() => router.push("/plan")} />
    </Notice>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: spacing.md },
  title: { gap: spacing.xxs },
  fill: { flex: 1 },
  actions: { gap: spacing.sm },
  page: { flex: 1, gap: spacing.md },
  indicator: { flexDirection: "row", gap: spacing.xxs },
  segment: { flex: 1, height: sizes.storyIndicator, borderRadius: radius.full },
  segmentDone: { backgroundColor: colors.primary },
  segmentRest: { backgroundColor: colors.border },
});

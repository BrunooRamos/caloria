import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ChevronLeft, ChevronRight, UtensilsCrossed } from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, FormError, IconButton, Skeleton, Text } from "@/components";
import { deviceTimeZone } from "@/features/profile/timezone";
import { errorMessage } from "@/services/error-messages";
import type { Meal } from "@/services/meals";
import { colors, radius, sizes, spacing, typography } from "@/theme";
import { dayTitle, formatTime, nextDay, previousDay, resolveDay, todayIn } from "./day";
import { MEAL_THUMBNAIL, MealRow } from "./MealRow";
import { useDayMeals } from "./useDayMeals";

/**
 * Historial por día (RF-08): las comidas de un día, de la más temprana a la más tardía, con flechas
 * para ir a días anteriores y volver hasta hoy. El día va en la ruta (`/history?date=YYYY-MM-DD`)
 * y se calcula en la zona del usuario.
 */
export default function HistoryScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const [timeZone] = useState(deviceTimeZone);
  const [today, setToday] = useState(() => todayIn(timeZone));
  // Si la pantalla quedó abierta de un día para el otro, "hoy" se corre al volver.
  useFocusEffect(useCallback(() => setToday(todayIn(timeZone)), [timeZone]));

  const day = resolveDay(params.date, today);
  const next = nextDay(day, today);
  const history = useDayMeals(day);
  const { state } = history;

  const goTo = (date: string) => router.setParams({ date });

  let empty;
  if (state.status === "loading") empty = <ListSkeleton />;
  else if (state.status === "error") {
    empty = (
      <View style={styles.error}>
        <FormError message={errorMessage(state.error)} />
        <Button variant="secondary" title="Reintentar" onPress={history.retry} />
      </View>
    );
  } else empty = <EmptyDay today={day === today} />;

  const meals = state.status === "ready" ? state.meals : [];

  return (
    <SafeAreaView edges={["bottom", "left", "right"]} style={styles.root}>
      <View style={styles.navigator}>
        <IconButton
          icon={ChevronLeft}
          label="Día anterior"
          onPress={() => goTo(previousDay(day))}
        />
        <Text variant="h3" accessibilityRole="header" style={styles.title}>
          {dayTitle(day, today)}
        </Text>
        <IconButton
          icon={ChevronRight}
          label="Día siguiente"
          disabled={!next}
          onPress={() => next && goTo(next)}
        />
      </View>
      <FlatList<Meal>
        testID="history-list"
        data={meals}
        keyExtractor={(meal) => meal.id}
        renderItem={({ item }) => (
          <MealRow
            meal={item}
            time={formatTime(item.capturedAt, timeZone)}
            onOpen={() => router.push({ pathname: "/meals/[id]", params: { id: item.id } })}
            onDelete={() => history.remove(item.id)}
          />
        )}
        ListHeaderComponent={
          state.status === "ready" && state.stale ? (
            <Text variant="small" color="inkMuted" accessibilityLiveRegion="polite">
              No pudimos actualizar. Estás viendo lo último que cargó.
            </Text>
          ) : undefined
        }
        ListEmptyComponent={empty}
        ListFooterComponent={
          <ListFooter
            loading={history.loadingMore}
            error={history.loadMoreError}
            onRetry={history.loadMore}
          />
        }
        // Si la última página falló, no se reintenta sola: queda el botón.
        onEndReached={() => {
          if (!history.loadMoreError) void history.loadMore();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={history.refreshing}
            onRefresh={history.refresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

function ListFooter({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: unknown;
  onRetry(): void;
}) {
  if (loading) {
    return <ActivityIndicator color={colors.primary} accessibilityLabel="Cargando más comidas" />;
  }
  if (error === null) return null;
  return (
    <View style={styles.error}>
      <FormError message={errorMessage(error)} />
      <Button variant="secondary" title="Cargar más" onPress={onRetry} />
    </View>
  );
}

/** Día sin comidas: neutral, sin presión, como en el dashboard. */
function EmptyDay({ today }: { today: boolean }) {
  return (
    <Card accessibilityLiveRegion="polite">
      <UtensilsCrossed color={colors.inkMuted} size={sizes.icon} strokeWidth={sizes.iconStroke} />
      <Text variant="bodyStrong">
        {today ? "Todavía no hay comidas hoy" : "No hay comidas este día"}
      </Text>
      <Text variant="small" color="inkMuted">
        {today
          ? "Cuando registres una, la vas a ver acá."
          : "Probá con otro día con las flechas de arriba."}
      </Text>
    </Card>
  );
}

/** La forma de la lista mientras carga: tres filas con foto, hora, plato y kcal. */
function ListSkeleton() {
  return (
    <View
      accessible
      accessibilityLabel="Cargando las comidas"
      accessibilityState={{ busy: true }}
      style={styles.skeleton}
    >
      {[0, 1, 2].map((key) => (
        <View key={key} style={styles.skeletonRow}>
          <Skeleton height={MEAL_THUMBNAIL} width={MEAL_THUMBNAIL} rounded="md" />
          <View style={styles.skeletonText}>
            <Skeleton height={typography.caption.lineHeight} width="20%" />
            <Skeleton height={typography.bodyStrong.lineHeight} width="70%" />
            <Skeleton height={typography.small.lineHeight} width="40%" />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  navigator: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  title: { flex: 1, textAlign: "center" },
  list: { flexGrow: 1, gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  error: { gap: spacing.md },
  skeleton: { gap: spacing.sm },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  skeletonText: { flex: 1, gap: spacing.xxs },
});

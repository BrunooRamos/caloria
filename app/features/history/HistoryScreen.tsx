import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Camera, ChevronLeft, ChevronRight, UtensilsCrossed } from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, FormError, IconButton, Notice, Text, TextButton } from "@/components";
import { MealListSkeleton, MealRow } from "@/features/meals/MealRow";
import { useOpenCapture } from "@/features/billing/captureGate";
import { deviceTimeZone } from "@/features/profile/timezone";
import { errorMessage } from "@/services/error-messages";
import type { Meal } from "@/services/meals";
import { colors, sizes, spacing } from "@/theme";
import { dayTitle, formatTime, nextDay, previousDay, resolveDay, todayIn } from "./day";
import { STALE_MESSAGE, TODAY_EMPTY } from "@/features/meals/texts";
import { useDayMeals } from "./useDayMeals";

/**
 * Historial por día: las comidas de un día, de la más temprana a la más tardía, con
 * "Anterior" y "Siguiente" para moverse entre días y "Ir a hoy" para volver. El día va en la ruta
 * (`/history?date=YYYY-MM-DD`) y se calcula en la zona del usuario.
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
  const openCapture = useOpenCapture();
  const { state } = history;

  const goTo = (date: string) => router.setParams({ date });

  let empty;
  if (state.status === "loading") empty = <MealListSkeleton />;
  else if (state.status === "error") {
    empty = (
      <View style={styles.error}>
        <FormError message={errorMessage(state.error)} />
        <Button variant="secondary" title="Reintentar" onPress={history.retry} />
      </View>
    );
  } else if (day === today) {
    empty = (
      <Notice icon={UtensilsCrossed} title={TODAY_EMPTY.title} detail={TODAY_EMPTY.detail}>
        <Button icon={Camera} title="Registrar comida" onPress={openCapture} />
      </Notice>
    );
  } else {
    empty = (
      <Notice
        icon={UtensilsCrossed}
        title="No hay comidas este día"
        detail="Probá con otro día o volvé a hoy."
      />
    );
  }

  const meals = state.status === "ready" ? state.meals : [];

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.root}>
      <View style={styles.header}>
        <Text variant="h1" accessibilityRole="header">
          Historial
        </Text>
        <View style={styles.navigator}>
          <IconButton
            icon={ChevronLeft}
            label="Día anterior"
            caption="Anterior"
            onPress={() => goTo(previousDay(day))}
          />
          <View style={styles.day}>
            <Text variant="h3" accessibilityRole="header" style={styles.centered}>
              {dayTitle(day, today)}
            </Text>
            {day !== today && <TextButton title="Ir a hoy" onPress={() => goTo(today)} />}
          </View>
          <IconButton
            icon={ChevronRight}
            label="Día siguiente"
            caption="Siguiente"
            disabled={!next}
            onPress={() => next && goTo(next)}
          />
        </View>
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
          />
        )}
        ListHeaderComponent={
          state.status === "ready" && state.stale ? (
            <Text variant="small" color="inkMuted" accessibilityLiveRegion="polite">
              {STALE_MESSAGE}
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  navigator: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs },
  day: { flex: 1, alignItems: "center", minHeight: sizes.touchTarget, justifyContent: "center" },
  centered: { textAlign: "center" },
  list: { flexGrow: 1, gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  error: { gap: spacing.md },
});

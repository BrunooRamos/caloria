import { router, useFocusEffect } from "expo-router";
import { Camera, Sprout, UtensilsCrossed } from "lucide-react-native";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { Button, Card, FormError, Logo, Notice, Screen, Text } from "@/components";
import { formatTime, longDayLabel, todayIn } from "@/features/history/day";
import { useDayMeals } from "@/features/history/useDayMeals";
import { MealListSkeleton, MealRow } from "@/features/meals/MealRow";
import { STALE_MESSAGE, TODAY_EMPTY } from "@/features/meals/texts";
import { deviceTimeZone } from "@/features/profile/timezone";
import type { DailyDashboard } from "@/services/dashboard";
import { errorMessage } from "@/services/error-messages";
import { colors, sizes, spacing } from "@/theme";
import { DashboardSkeleton, KcalSkeleton } from "./DashboardSkeleton";
import { mealsCount } from "./format";
import { NutrientBar } from "./NutrientBar";
import { StreakCard } from "./StreakCard";
import { useDailyDashboard } from "./useDailyDashboard";

const MACROS = [
  { key: "protein", target: "proteinG", label: "Proteínas" },
  { key: "carbs", target: "carbsG", label: "Carbohidratos" },
  { key: "fat", target: "fatG", label: "Grasas" },
] as const;

/**
 * Pantalla principal, en orden de importancia: cuánto comiste hoy contra tu meta con el
 * botón de registrar al lado, las comidas del día, los macros y la racha. Muestra lo que
 * devuelven `GET /dashboard/daily` y `GET /meals` sin recalcular nada. Registrar está en todos los
 * estados y lleva tres toques: el botón, la foto y "Enviar".
 */
export default function DashboardScreen() {
  const dashboard = useDailyDashboard();
  const [timeZone] = useState(deviceTimeZone);
  const [today, setToday] = useState(() => todayIn(timeZone));
  useFocusEffect(useCallback(() => setToday(todayIn(timeZone)), [timeZone]));
  const meals = useDayMeals(today);
  useMealsFollowDashboard(dashboard.state, meals.reload);

  const { state } = dashboard;
  let body;
  if (state.status === "loading") {
    body = (
      <>
        <TodayCard>
          <KcalSkeleton />
        </TodayCard>
        <DashboardSkeleton />
      </>
    );
  } else if (state.status === "error") {
    body = (
      <TodayCard>
        <FormError message={errorMessage(state.error)} />
        <Button variant="secondary" title="Reintentar" onPress={dashboard.retry} />
      </TodayCard>
    );
  } else {
    body = (
      <DayContent
        dashboard={state.dashboard}
        stale={state.stale}
        meals={<TodayMeals meals={meals} timeZone={timeZone} dashboard={state.dashboard} />}
      />
    );
  }

  return (
    <Screen
      scroll
      edges={["top", "left", "right"]}
      refreshControl={
        <RefreshControl
          refreshing={dashboard.refreshing}
          onRefresh={() => {
            dashboard.refresh();
            void meals.reload();
          }}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Logo variant="color" width={sizes.logo.homeWidth} />
          <View style={styles.title}>
            <Text variant="h1" accessibilityRole="header">
              Hoy
            </Text>
            <Text color="inkMuted">{capitalize(longDayLabel(today, today))}</Text>
          </View>
        </View>
        {body}
      </View>
    </Screen>
  );
}

/**
 * La lista del día se vuelve a pedir cuando cambian los conteos del dashboard, que consulta solo
 * mientras hay comidas analizándose: así una comida que terminó pasa a lista sin tocar nada.
 */
function useMealsFollowDashboard(
  state: ReturnType<typeof useDailyDashboard>["state"],
  reload: () => Promise<void>,
) {
  const counts =
    state.status === "ready"
      ? `${state.dashboard.meals.ready}-${state.dashboard.meals.processing}-${state.dashboard.meals.failed}`
      : null;
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (counts === null) return;
    if (previous.current !== null && previous.current !== counts) void reload();
    previous.current = counts;
  }, [counts, reload]);
}

/** Lo primero: el total del día contra la meta y registrar una comida. */
function TodayCard({ children }: { children: ReactNode }) {
  return (
    <Card>
      {children}
      <View style={styles.register}>
        <Button icon={Camera} title="Registrar comida" onPress={() => router.push("/capture")} />
      </View>
    </Card>
  );
}

function DayContent({
  dashboard,
  stale,
  meals,
}: {
  dashboard: DailyDashboard;
  stale: boolean;
  meals: ReactNode;
}) {
  const { consumed, targets, streak } = dashboard;
  const { processing } = dashboard.meals;
  // Nunca registró nada: macros y racha estarían en cero. La lista invita a la primera comida.
  const newcomer = streak.best === 0 && isEmptyDay(dashboard);
  return (
    <>
      {stale && (
        <Text variant="small" color="inkMuted" accessibilityLiveRegion="polite">
          {STALE_MESSAGE}
        </Text>
      )}
      <TodayCard>
        <NutrientBar
          label="Calorías"
          consumed={consumed.kcal}
          target={targets.kcal}
          unit="kcal"
          main
        />
        {processing > 0 && (
          <Text variant="small" color="inkMuted" accessibilityLiveRegion="polite">
            {`${mealsCount(processing)} analizándose: el total se actualiza cuando termine el análisis.`}
          </Text>
        )}
      </TodayCard>
      {meals}
      {!newcomer && (
        <>
          <Card>
            <View style={styles.macros}>
              {MACROS.map(({ key, target, label }) => (
                <NutrientBar
                  key={key}
                  label={label}
                  consumed={consumed[key]}
                  target={targets[target]}
                  unit="g"
                />
              ))}
            </View>
          </Card>
          <StreakCard streak={streak} />
        </>
      )}
    </>
  );
}

function isEmptyDay({ meals }: DailyDashboard) {
  return meals.ready + meals.processing + meals.failed === 0;
}

function TodayMeals({
  meals,
  timeZone,
  dashboard,
}: {
  meals: ReturnType<typeof useDayMeals>;
  timeZone: string;
  dashboard: DailyDashboard;
}) {
  const { state } = meals;
  let content;
  if (state.status === "loading") content = <MealListSkeleton rows={2} />;
  else if (state.status === "error") {
    content = (
      <View style={styles.error}>
        <FormError message={errorMessage(state.error)} />
        <Button variant="secondary" title="Reintentar" onPress={meals.retry} />
      </View>
    );
  } else if (state.meals.length === 0) {
    content =
      dashboard.streak.best === 0 ? (
        <Notice
          icon={Sprout}
          title="Registrá tu primera comida"
          detail="Sacale una foto a lo que vas a comer: en unos segundos ves sus calorías y macros acá."
        />
      ) : (
        <Notice icon={UtensilsCrossed} title={TODAY_EMPTY.title} detail={TODAY_EMPTY.detail} />
      );
  } else {
    content = (
      <>
        {state.meals.map((meal) => (
          <MealRow
            key={meal.id}
            meal={meal}
            time={formatTime(meal.capturedAt, timeZone)}
            onOpen={() => router.push({ pathname: "/meals/[id]", params: { id: meal.id } })}
          />
        ))}
        {state.nextCursor !== null && (
          <Button
            variant="ghost"
            title="Ver todas en el historial"
            onPress={() => router.push("/history")}
          />
        )}
      </>
    );
  }

  return (
    <View style={styles.section}>
      <Text variant="h2" accessibilityRole="header">
        Comidas de hoy
      </Text>
      {content}
    </View>
  );
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl },
  header: { alignItems: "center", marginTop: -spacing.md },
  title: { alignSelf: "stretch", gap: spacing.xxs },
  register: { marginTop: spacing.xs },
  section: { gap: spacing.sm },
  error: { gap: spacing.md },
  macros: { gap: spacing.lg },
});

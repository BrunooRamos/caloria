import { Link, router } from "expo-router";
import { Camera } from "lucide-react-native";
import { RefreshControl, StyleSheet, View } from "react-native";
import { Button, Card, Fab, FormError, Screen, Text } from "@/components";
import { SessionDebug } from "@/features/auth/SessionDebug";
import type { DailyDashboard } from "@/services/dashboard";
import { errorMessage } from "@/services/error-messages";
import { colors, sizes, spacing } from "@/theme";
import { AnalyzingNotice, EmptyDayNotice, FailedNotice } from "./DayNotices";
import { DashboardSkeleton } from "./DashboardSkeleton";
import { NutrientBar } from "./NutrientBar";
import { useDailyDashboard } from "./useDailyDashboard";

const MACROS = [
  { key: "protein", target: "proteinG", label: "Proteína" },
  { key: "carbs", target: "carbsG", label: "Carbohidratos" },
  { key: "fat", target: "fatG", label: "Grasas" },
] as const;

/**
 * Pantalla principal: el progreso del día contra la meta (RF-09). Muestra lo que devuelve
 * `GET /dashboard/daily` sin recalcular nada. El botón de registrar está en todos los estados
 * (RNF-06: botón, foto y confirmar).
 */
export default function DashboardScreen() {
  const { state, refreshing, refresh, retry } = useDailyDashboard();

  let body;
  if (state.status === "loading") body = <DashboardSkeleton />;
  else if (state.status === "error") {
    body = (
      <View style={styles.error}>
        <FormError message={errorMessage(state.error)} />
        <Button variant="secondary" title="Reintentar" onPress={retry} />
      </View>
    );
  } else body = <DayProgress dashboard={state.dashboard} stale={state.stale} />;

  return (
    <View style={styles.root}>
      <Screen
        scroll
        edges={["bottom", "left", "right"]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <View style={styles.content}>
          <Text variant="h1" accessibilityRole="header">
            Hoy
          </Text>
          {body}
          <Link href="/profile" asChild>
            <Button variant="ghost" title="Mi perfil" />
          </Link>
          {__DEV__ && <SessionDebug />}
        </View>
      </Screen>
      <Fab icon={Camera} label="Registrar comida" onPress={() => router.push("/capture")} />
    </View>
  );
}

function DayProgress({ dashboard, stale }: { dashboard: DailyDashboard; stale: boolean }) {
  const { consumed, targets, meals } = dashboard;
  const empty = meals.ready + meals.processing + meals.failed === 0;
  return (
    <>
      {stale && (
        <Text variant="small" color="inkMuted" accessibilityLiveRegion="polite">
          No pudimos actualizar. Estás viendo lo último que cargó.
        </Text>
      )}
      {empty && <EmptyDayNotice />}
      {meals.processing > 0 && <AnalyzingNotice count={meals.processing} />}
      {meals.failed > 0 && <FailedNotice count={meals.failed} />}
      <Card>
        <NutrientBar
          label="Energía"
          consumed={consumed.kcal}
          target={targets.kcal}
          unit="kcal"
          main
        />
      </Card>
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
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Aire abajo para que el botón flotante no tape lo último.
  content: { gap: spacing.xl, paddingBottom: sizes.fab + spacing.xl },
  error: { gap: spacing.md },
  macros: { gap: spacing.lg },
});

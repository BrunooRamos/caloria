import { Check } from "lucide-react-native";
import type { ReactNode } from "react";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import {
  Badge,
  Button,
  Card,
  FormError,
  ProgressBar,
  Screen,
  Skeleton,
  Text,
  confirmAction,
} from "@/components";
import { deviceTimeZone } from "@/features/profile/timezone";
import { errorMessage } from "@/services/error-messages";
import { colors, sizes, spacing, typography } from "@/theme";
import { paymentGateway } from "./payments";
import { planView } from "./planView";
import type { OfferView, PlanAction, PlanView } from "./planView";
import { usePlanScreen } from "./usePlan";

/**
 * Tu plan: el plan vigente con los análisis que quedan y cuándo se renueva, qué
 * incluye cada plan con su precio, y suscribirse o cancelar a la vista, con los mismos pasos.
 */
export default function PlanScreen() {
  const screen = usePlanScreen(paymentGateway);
  const { state, checkout, busy, error } = screen;
  const [timeZone] = useState(deviceTimeZone);

  async function confirmThen(action: Extract<PlanAction, { kind: "cancel" | "reactivate" }>) {
    if (!(await confirmAction(action.confirm))) return;
    if (action.kind === "cancel") await screen.cancel(action.done);
    else await screen.subscribe("reactivate", action.done);
  }

  let content: ReactNode;
  if (state.status === "loading") {
    content = <PlanSkeleton />;
  } else if (state.status === "error") {
    content = (
      <View style={styles.section}>
        <FormError message={errorMessage(state.error)} />
        <Button variant="secondary" title="Reintentar" onPress={screen.reload} />
      </View>
    );
  } else {
    const view = planView({
      plan: state.plan,
      catalog: state.catalog,
      checkout,
      timeZone,
      now: new Date(),
    });
    const { action } = view;
    content = (
      <>
        <CurrentPlan view={view} onRetry={screen.retryConfirmation} />
        {action && action.kind !== "subscribe" && (
          <View style={styles.section}>
            <Text variant="h3" accessibilityRole="header">
              Tu suscripción
            </Text>
            <Terms lines={action.terms} />
            <FormError message={error} />
            <Button
              variant="secondary"
              title={action.title}
              loading={busy === action.kind}
              disabled={busy !== null}
              onPress={() => void confirmThen(action)}
            />
          </View>
        )}
        <View style={styles.section}>
          <Text variant="h3" accessibilityRole="header">
            Qué incluye cada plan
          </Text>
          {view.offers.map((offer) => (
            <Offer key={offer.tier} offer={offer}>
              {offer.tier === "premium" && action?.kind === "subscribe" && (
                <View style={styles.subscribe}>
                  <Terms lines={action.terms} />
                  <Text variant="small" color="inkMuted">
                    {paymentGateway.paymentNote}
                  </Text>
                  <FormError message={error} />
                  <Button
                    title={action.title}
                    loading={busy === "subscribe"}
                    disabled={busy !== null}
                    onPress={() => void screen.subscribe("subscribe")}
                  />
                </View>
              )}
            </Offer>
          ))}
        </View>
      </>
    );
  }

  return (
    <Screen scroll edges={["bottom", "left", "right"]}>
      <View style={styles.content}>{content}</View>
    </Screen>
  );
}

/** El plan vigente. Quedarse sin análisis va en los mismos colores: no es una alarma. */
function CurrentPlan({ view, onRetry }: { view: PlanView; onRetry(): void }) {
  const { current, state } = view;
  const waiting = state === "checking" || state === "confirming";
  return (
    <Card accessibilityLiveRegion="polite">
      {current.label !== null && <Badge label={current.label} />}
      <View style={styles.headline}>
        {waiting && <ActivityIndicator color={colors.primary} />}
        <Text variant="h2" color="primary" style={styles.shrink}>
          {current.headline}
        </Text>
      </View>
      {current.usage && <ProgressBar progress={current.usage.used / current.usage.limit} />}
      {current.detail ? <Text color="inkMuted">{current.detail}</Text> : null}
      {state === "slow" && <Button variant="secondary" title="Actualizar" onPress={onRetry} />}
    </Card>
  );
}

function Offer({ offer, children }: { offer: OfferView; children?: ReactNode }) {
  return (
    <Card>
      <View style={styles.offerTitle}>
        <Text variant="h3" accessibilityRole="header" style={styles.shrink}>
          {offer.name}
        </Text>
        {offer.current && <Badge label="Tu plan" />}
      </View>
      <Text variant="h2" color="primary">
        {offer.price}
      </Text>
      <View style={styles.features}>
        {[offer.quota, ...offer.features].map((feature) => (
          <View key={feature} style={styles.feature}>
            <Check color={colors.primary} size={sizes.iconDense} strokeWidth={sizes.iconStroke} />
            <Text style={styles.shrink}>{feature}</Text>
          </View>
        ))}
      </View>
      {children}
    </Card>
  );
}

/** Lo que hay que saber antes de tocar el botón: en texto normal, no en letra chica. */
function Terms({ lines }: { lines: string[] }) {
  return lines.map((line) => <Text key={line}>{line}</Text>);
}

function PlanSkeleton() {
  return (
    <View
      accessible
      accessibilityLabel="Cargando tu plan"
      accessibilityState={{ busy: true }}
      style={styles.content}
    >
      <Card>
        <Skeleton height={typography.caption.lineHeight} width="20%" rounded="full" />
        <Skeleton height={typography.h2.lineHeight} width="80%" />
        <Skeleton height={sizes.progress} rounded="full" />
        <Skeleton height={typography.body.lineHeight} width="55%" />
      </Card>
      <Card>
        <Skeleton height={typography.h3.lineHeight} width="30%" />
        <Skeleton height={typography.h2.lineHeight} width="50%" />
        <Skeleton height={typography.body.lineHeight} width="70%" />
        <Skeleton height={typography.body.lineHeight} width="60%" />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl },
  section: { gap: spacing.sm },
  headline: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  shrink: { flexShrink: 1 },
  offerTitle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  features: { gap: spacing.xs },
  feature: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs },
  subscribe: { gap: spacing.sm, marginTop: spacing.sm },
});

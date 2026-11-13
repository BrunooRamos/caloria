import { Redirect } from "expo-router";
import { isBillingEnabled } from "@/features/billing/billingEnabled";
import PlanScreen from "@/features/billing/PlanScreen";

/** Sin pagos (build de Google Play), Tu plan no existe: lleva al inicio. */
export default function PlanRoute() {
  if (!isBillingEnabled()) return <Redirect href="/" />;
  return <PlanScreen />;
}

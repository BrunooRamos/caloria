import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components";
import { ApiError } from "@/services/api-error";
import { getBillingPlan, getPlanCatalog } from "@/services/billing";
import type { BillingPlan, PlanCatalog } from "@/services/billing";
import { errorMessage } from "@/services/error-messages";
import type { ErrorMessageOverrides } from "@/services/error-messages";
import { paymentGateway } from "./payments";
import type { PaymentGateway } from "./payments";
import type { CheckoutStatus, PlanAction } from "./planView";

/**
 * Después de pagar se consulta el plan hasta que llega la confirmación del proveedor (webhook):
 * cada 2 s durante 30 s. Si se cerró el checkout sin volver por la URL de éxito, se revisa solo
 * unos segundos, por si pagó igual.
 */
export const CONFIRM_POLL = { intervalMs: 2000, attempts: 15 } as const;
export const CHECK_POLL = { intervalMs: 2000, attempts: 3 } as const;

export const PREMIUM_READY_MESSAGE = "Listo: ya tenés premium.";

const SUBSCRIBE_ERRORS: ErrorMessageOverrides = {
  SERVICE_UNAVAILABLE:
    "Los pagos no están disponibles ahora. Probá de nuevo en unos minutos; no se te cobró nada.",
};

const CANCEL_ERRORS: ErrorMessageOverrides = {
  SERVICE_UNAVAILABLE:
    "No pudimos cancelar ahora. Probá de nuevo en unos minutos; tu suscripción sigue como estaba.",
};

export type BillingPlanState =
  | { status: "loading" }
  | { status: "ready"; plan: BillingPlan }
  | { status: "error"; error: unknown };

/** `GET /billing/plan`, cada vez que la pantalla gana el foco (la fila del perfil). */
export function useBillingPlan(): BillingPlanState {
  const [state, setState] = useState<BillingPlanState>({ status: "loading" });
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getBillingPlan().then(
        (plan) => active && setState({ status: "ready", plan }),
        // Con datos en pantalla, un pedido que falla no los tapa.
        (error: unknown) =>
          active &&
          setState((prev) => (prev.status === "ready" ? prev : { status: "error", error })),
      );
      return () => {
        active = false;
      };
    }, []),
  );
  return state;
}

export type PlanScreenState =
  | { status: "loading" }
  | { status: "ready"; plan: BillingPlan; catalog: PlanCatalog }
  | { status: "error"; error: unknown };

function fetchAll(): Promise<PlanScreenState> {
  return Promise.all([getBillingPlan(), getPlanCatalog()]).then(
    ([plan, catalog]): PlanScreenState => ({ status: "ready", plan, catalog }),
    (error: unknown): PlanScreenState => ({ status: "error", error }),
  );
}

/**
 * Todo lo de la pantalla de Tu plan: el plan y el catálogo, suscribirse, cancelar y la espera de la
 * confirmación del pago, tanto si vuelve por la respuesta del navegador como por el deep link
 * (`/plan?checkout=success`, que arma la ruta billing/return).
 */
export function usePlanScreen(gateway: PaymentGateway = paymentGateway) {
  const toast = useToast();
  const [state, setState] = useState<PlanScreenState>({ status: "loading" });
  const [checkout, setCheckout] = useState<CheckoutStatus>("idle");
  const [busy, setBusy] = useState<PlanAction["kind"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tier = state.status === "ready" ? state.plan.tier : null;

  useEffect(() => {
    let active = true;
    void fetchAll().then((next) => active && setState(next));
    return () => {
      active = false;
    };
  }, []);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    void fetchAll().then(setState);
  }, []);

  const setPlan = useCallback((plan: BillingPlan) => {
    setState((prev) => (prev.status === "ready" ? { ...prev, plan } : prev));
  }, []);

  // La vuelta del checkout por deep link: se atiende una vez por cada vez que llega el parámetro.
  const { checkout: returned } = useLocalSearchParams<{ checkout?: string }>();
  const [seenReturn, setSeenReturn] = useState<string | undefined>(undefined);
  if (returned !== seenReturn) {
    setSeenReturn(returned);
    // Si ya es premium no hay nada que esperar.
    if (returned === "success" && tier !== "premium") setCheckout("confirming");
  }
  useEffect(() => {
    if (returned) router.setParams({ checkout: undefined });
  }, [returned]);

  // Espera la confirmación: termina cuando el plan es premium o se acaban los intentos.
  useEffect(() => {
    if (checkout !== "confirming" && checkout !== "checking") return;
    const { intervalMs, attempts } = checkout === "confirming" ? CONFIRM_POLL : CHECK_POLL;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let count = 0;

    async function poll() {
      count += 1;
      try {
        const plan = await getBillingPlan();
        if (!active) return;
        setPlan(plan);
        if (plan.tier === "premium") {
          setCheckout("idle");
          toast(PREMIUM_READY_MESSAGE);
          return;
        }
      } catch {
        // Un pedido que falla no corta la espera: se vuelve a probar.
      }
      if (!active) return;
      if (count >= attempts) {
        // Sin la vuelta por la URL de éxito, que no aparezca no es un problema: no pagó.
        setCheckout(checkout === "confirming" ? "slow" : "idle");
        return;
      }
      timer = setTimeout(() => void poll(), intervalMs);
    }

    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [checkout, setPlan, toast]);

  /** Suscribirse (free) o volver a activar una suscripción cancelada (`done`: el aviso). */
  const subscribe = useCallback(
    async (kind: "subscribe" | "reactivate", done = PREMIUM_READY_MESSAGE) => {
      setBusy(kind);
      setError(null);
      try {
        const outcome = await gateway.subscribe();
        if (outcome.kind === "reactivated") {
          setPlan(outcome.plan);
          toast(done);
        } else if (outcome.kind === "confirming") {
          setCheckout("confirming");
        } else if (outcome.kind === "closed") {
          setCheckout("checking");
        }
      } catch (err) {
        // El plan en pantalla estaba viejo: se trae el de verdad.
        if (err instanceof ApiError && err.code === "SUBSCRIPTION_ACTIVE") {
          getBillingPlan().then(setPlan, () => undefined);
        }
        setError(errorMessage(err, SUBSCRIBE_ERRORS));
      } finally {
        setBusy(null);
      }
    },
    [gateway, setPlan, toast],
  );

  const cancel = useCallback(
    async (done: string) => {
      setBusy("cancel");
      setError(null);
      try {
        setPlan(await gateway.cancel());
        toast(done);
      } catch (err) {
        setError(errorMessage(err, CANCEL_ERRORS));
      } finally {
        setBusy(null);
      }
    },
    [gateway, setPlan, toast],
  );

  /** "Actualizar" cuando la confirmación tarda: vuelve a esperar. */
  const retryConfirmation = useCallback(() => setCheckout("confirming"), []);

  return { state, checkout, busy, error, reload, subscribe, cancel, retryConfirmation };
}

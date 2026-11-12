import { router } from "expo-router";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { PropsWithChildren } from "react";
import { deviceTimeZone } from "@/features/profile/timezone";
import { getBillingPlan } from "@/services/billing";
import type { BillingPlan } from "@/services/billing";
import { isBillingEnabled } from "./billingEnabled";
import { QuotaSheet } from "./QuotaSheet";
import { hasAnalysesLeft, quotaView } from "./planView";
import type { QuotaView } from "./planView";
import { useBillingPlan } from "./usePlan";

/** Cuánto se espera el plan antes de abrir la cámara igual. */
export const PLAN_CHECK_TIMEOUT_MS = 5000;

const openCaptureDirectly = () => router.push("/capture");

/** El plan recién pedido; null si no llega a tiempo o falla. */
async function freshPlan(): Promise<BillingPlan | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLAN_CHECK_TIMEOUT_MS);
  try {
    return await getBillingPlan(controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sin el provider (una pantalla fuera de las pestañas), abre la cámara directo: el Backend igual
 * rechaza la comida y la vista previa lo avisa.
 */
const OpenCaptureContext = createContext<() => void>(openCaptureDirectly);

/** Lo que tiene que usar todo botón que abra la cámara, en vez de `router.push("/capture")`. */
export function useOpenCapture(): () => void {
  return useContext(OpenCaptureContext);
}

/**
 * Va en el layout de las pestañas. "Registrar" sin análisis disponibles no abre la cámara: muestra
 * una hoja con lo que dice Tu plan y la opción de ir a ver los planes.
 *
 * Decide con el plan que se pide cada vez que vuelven las pestañas, así la cámara se abre sin
 * esperar. Antes de frenar a alguien lo confirma con un pedido nuevo, por si pasó a premium o
 * empezó otro mes. Si el plan no se puede saber, abre la cámara igual: el Backend rechaza la
 * comida y la vista previa lo avisa.
 */
export function CaptureGateProvider({ children }: PropsWithChildren) {
  const billing = useBillingPlan();
  const known = billing.status === "ready" ? billing.plan : null;
  const checking = useRef(false);
  const [quota, setQuota] = useState<QuotaView | null>(null);
  const [open, setOpen] = useState(false);

  const openCapture = useCallback(() => {
    if (checking.current) return;
    if (known && hasAnalysesLeft(known)) {
      openCaptureDirectly();
      return;
    }
    checking.current = true;
    void freshPlan()
      .then((plan) => {
        if (!plan || hasAnalysesLeft(plan)) {
          openCaptureDirectly();
          return;
        }
        setQuota(quotaView(plan, deviceTimeZone(), new Date()));
        setOpen(true);
      })
      .finally(() => {
        checking.current = false;
      });
  }, [known]);

  const close = useCallback(() => setOpen(false), []);
  const seePlans = useCallback(() => {
    setOpen(false);
    if (isBillingEnabled()) router.push("/plan");
  }, []);

  return (
    <OpenCaptureContext value={openCapture}>
      {children}
      <QuotaSheet view={quota} visible={open} onClose={close} onSeePlans={seePlans} />
    </OpenCaptureContext>
  );
}

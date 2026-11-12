import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { router as appRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { CONFIRM_POLL, CHECK_POLL } from "@/features/billing/usePlan";
import type { BillingPlan } from "@/services/billing";
import { createHttpClient } from "@/services/http-client";
import type { HttpClient } from "@/services/http-client";
import { spyAlerts } from "@/test-utils/alert";
import {
  BASE_URL,
  NEW_TOKENS,
  OLD_TOKENS,
  apiError,
  fakeFetch,
  json,
  memoryStorage,
} from "@/test-utils/fake-api";
import type { Call, Handler } from "@/test-utils/fake-api";
import { billingSwitch, expectNoPaymentText } from "@/test-utils/billing";

jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hide: jest.fn(),
}));

jest.mock("expo-localization", () => ({
  getCalendars: () => [{ timeZone: "America/Montevideo" }],
}));

jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));

// Rutas, store y cliente HTTP reales; solo se reemplazan SecureStore, la red y el navegador.
let mockApi: HttpClient;
let mockTokenStorage: ReturnType<typeof memoryStorage>;
jest.mock("@/services/api", () => ({
  get api() {
    return mockApi;
  },
  get tokenStorage() {
    return mockTokenStorage;
  },
}));

const openAuthSession = jest.mocked(WebBrowser.openAuthSessionAsync);

// 9 de noviembre a las 12:00 en Montevideo.
const NOW = new Date("2026-11-09T15:00:00.000Z");
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_123";
const PERIOD_END = "2026-12-04T15:00:00.000Z";

const free = (remaining = 37): BillingPlan => ({
  tier: "free",
  periodEnd: null,
  renews: false,
  analyses: { limit: 40, remaining, resetsOn: "2026-12-01" },
});

const premium = (renews = true): BillingPlan => ({
  tier: "premium",
  periodEnd: PERIOD_END,
  renews,
  analyses: { limit: null, remaining: null, resetsOn: null },
});

let calls: Call[];
let plans: BillingPlan[];

/** Cada `GET /billing/plan` devuelve el siguiente de `plans`; el último se repite. */
function nextPlan(): BillingPlan {
  const plan = plans.length > 1 ? plans.shift() : plans[0];
  if (!plan) throw new Error("Sin plan");
  return plan;
}

interface Backend {
  subscribe?: Handler;
  cancel?: Handler;
}

function start(initialUrl: string, initialPlans: BillingPlan[], backend: Backend = {}) {
  plans = [...initialPlans];
  mockTokenStorage = memoryStorage(OLD_TOKENS);
  const fake = fakeFetch((call) => {
    if (call.path === "/auth/refresh") return json(200, { ...NEW_TOKENS });
    if (call.path === "/billing/plan") return json(200, nextPlan());
    if (call.path === "/billing/subscribe") {
      return (backend.subscribe ?? checkout)(call);
    }
    if (call.path === "/billing/cancel")
      return (backend.cancel ?? (() => json(200, premium(false))))(call);
    return apiError(404, "NOT_FOUND");
  });
  calls = fake.calls;
  mockApi = createHttpClient({ baseUrl: BASE_URL, storage: mockTokenStorage, fetch: fake.fetch });
  return renderRouter("./src/app", { initialUrl });
}

const checkout = () => json(200, { action: "checkout", checkoutUrl: CHECKOUT_URL, plan: free() });
const posts = (path: string) =>
  calls.filter((call) => call.path === path && call.method === "POST");
const press = async (name: string | RegExp) =>
  fireEvent.press(await screen.findByRole("button", { name }));
const wait = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

/** Pantallas apiladas en el grupo con sesión. */
const appRoutes = (router: Awaited<ReturnType<typeof start>>) =>
  router.getRouterState()?.routes[0]?.state?.routes[0]?.state?.routes.map((route) => route.name);

const SUBSCRIBE = "Suscribirme por US$ 4,99 por mes";

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  openAuthSession.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("free", () => {
  it("el plan vigente, cuántos análisis quedan y cuándo se renuevan", async () => {
    await start("/plan", [free(37)]);

    expect(await screen.findByText("Te quedan 37 de 40 análisis este mes")).toBeOnTheScreen();
    expect(screen.getByText("Se renuevan el 1 de diciembre.")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Tu plan" })).toBeOnTheScreen();
  });

  it("antes de suscribirse se lee el precio, la renovación y cómo se cancela, sin nada premarcado", async () => {
    await start("/plan", [free()]);

    expect(await screen.findByText("US$ 4,99 por mes")).toBeOnTheScreen();
    expect(screen.getByText("Gratis")).toBeOnTheScreen();
    expect(screen.getByText("Análisis ilimitados")).toBeOnTheScreen();
    expect(screen.getByText("Wrapped completo cada semana")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Se cobran US$ 4,99 hoy y la suscripción se renueva sola cada mes: el próximo cobro es el 9 de diciembre.",
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Podés cancelarla cuando quieras desde esta pantalla. Seguís con premium hasta el final del período que pagaste y no se te cobra más.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText(/página segura de Stripe/)).toBeOnTheScreen();
    // Ni casillas ni opciones elegidas de antemano, ni pruebas gratis.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText(/prueba|gratis por|trial/i)).toBeNull();
    // La salida, siempre a la vista.
    expect(screen.getByRole("button", { name: "Volver" })).toBeOnTheScreen();
  });

  it("sin análisis: lo dice sin rojo y se puede suscribir igual", async () => {
    await start("/plan", [free(0)]);

    expect(await screen.findByText("Usaste los 40 análisis de este mes")).toBeOnTheScreen();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: SUBSCRIBE })).toBeOnTheScreen();
  });

  it("desde el perfil, y Volver regresa", async () => {
    const router = await start("/profile", [free()]);

    await press("Tu plan, Free · te quedan 37 análisis");
    expect(router.getPathname()).toBe("/plan");
    await press("Volver");
    expect(router.getPathname()).toBe("/profile");
  });
});

describe("suscribirse", () => {
  it("un toque abre el checkout; al volver, confirma el pago y pasa a premium", async () => {
    openAuthSession.mockResolvedValue({
      type: "success",
      url: "caloria://billing/return?result=success",
    });
    await start("/plan", [free(), free(), premium()]);

    // Paso 1 de 2: el botón. El paso 2 es pagar en el checkout.
    await press(SUBSCRIBE);

    // Volvió del checkout: está confirmando, no es un error, y no hay cómo pagar de nuevo.
    expect(await screen.findByText("Estamos confirmando tu pago")).toBeOnTheScreen();
    expect(posts("/billing/subscribe")).toHaveLength(1);
    expect(openAuthSession).toHaveBeenCalledWith(
      CHECKOUT_URL,
      expect.stringMatching(/:\/\/billing\/return$/),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: SUBSCRIBE })).toBeNull();

    await wait(CONFIRM_POLL.intervalMs);
    expect(await screen.findByText("Listo: ya tenés premium.")).toBeOnTheScreen();
    // El plan vigente y la tarjeta del premium, ahora marcada como la suya.
    expect(screen.getAllByText("Análisis ilimitados")).toHaveLength(2);
    expect(screen.getByText("Se renueva el 4 de diciembre por US$ 4,99.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Cancelar suscripción" })).toBeOnTheScreen();
  });

  it("si la confirmación tarda, lo dice sin error y Actualizar vuelve a consultar", async () => {
    openAuthSession.mockResolvedValue({
      type: "success",
      url: "caloria://billing/return?result=success",
    });
    await start("/plan", [free()]);

    await press(SUBSCRIBE);
    await screen.findByText("Estamos confirmando tu pago");
    await wait(CONFIRM_POLL.intervalMs * CONFIRM_POLL.attempts);
    expect(
      await screen.findByText("Todavía no nos llegó la confirmación del pago"),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: SUBSCRIBE })).toBeNull();

    plans = [premium()];
    await press("Actualizar");
    expect(await screen.findByText("Listo: ya tenés premium.")).toBeOnTheScreen();
  });

  it("si cierra el checkout, revisa un momento y, si no pagó, queda como estaba sin error", async () => {
    // El usuario cerró el navegador (`WebBrowserResultType.CANCEL`; el módulo está simulado).
    openAuthSession.mockResolvedValue({ type: "cancel" as WebBrowser.WebBrowserResultType });
    await start("/plan", [free()]);

    await press(SUBSCRIBE);
    expect(await screen.findByText("Revisando si se completó el pago")).toBeOnTheScreen();
    await wait(CHECK_POLL.intervalMs * CHECK_POLL.attempts);
    expect(await screen.findByText("Te quedan 37 de 40 análisis este mes")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: SUBSCRIBE })).toBeOnTheScreen();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("si vuelve por la URL de cancelar, no espera ninguna confirmación", async () => {
    openAuthSession.mockResolvedValue({
      type: "success",
      url: "caloria://billing/return?result=cancel",
    });
    await start("/plan", [free()]);

    await press(SUBSCRIBE);
    expect(await screen.findByRole("button", { name: SUBSCRIBE })).toBeOnTheScreen();
    expect(screen.queryByText("Revisando si se completó el pago")).toBeNull();
    expect(screen.queryByText("Estamos confirmando tu pago")).toBeNull();
  });

  it("si los pagos no están disponibles, lo dice y no abre el checkout", async () => {
    await start("/plan", [free()], { subscribe: () => apiError(503, "SERVICE_UNAVAILABLE") });

    await press(SUBSCRIBE);
    expect(
      await screen.findByText(
        "Los pagos no están disponibles ahora. Probá de nuevo en unos minutos; no se te cobró nada.",
      ),
    ).toBeOnTheScreen();
    expect(openAuthSession).not.toHaveBeenCalled();
  });
});

describe("la vuelta por deep link", () => {
  it("abre Tu plan confirmando el pago, y Volver va al inicio", async () => {
    const router = await start("/billing/return?result=success", [free(), free(), premium()]);

    expect(await screen.findByText("Estamos confirmando tu pago")).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/plan");
    await wait(CONFIRM_POLL.intervalMs);
    expect(await screen.findByText("Listo: ya tenés premium.")).toBeOnTheScreen();

    await press("Volver");
    expect(router.getPathname()).toBe("/");
  });

  it("si Tu plan ya estaba abierta, vuelve a esa sin apilar otra", async () => {
    const router = await start("/plan", [free(), free(), premium()]);
    await screen.findByRole("button", { name: SUBSCRIBE });

    await act(() => appRouter.push("/billing/return?result=success"));
    expect(await screen.findByText("Estamos confirmando tu pago")).toBeOnTheScreen();
    expect(appRoutes(router)?.filter((name) => name === "plan")).toHaveLength(1);
    expect(appRoutes(router)).not.toContain("billing/return");
  });
});

describe("cancelar", () => {
  it("dos toques, como suscribirse: el diálogo dice hasta cuándo sigue premium", async () => {
    const alerts = spyAlerts();
    await start("/plan", [premium()]);

    expect(
      await screen.findByText(
        "Si cancelás, seguís con premium hasta el 4 de diciembre. Después pasás al plan free, con 40 análisis por mes, y no se te cobra más.",
      ),
    ).toBeOnTheScreen();

    // Paso 1 de 2.
    await press("Cancelar suscripción");
    expect(alerts.last()).toMatchObject({
      title: "¿Cancelar la suscripción?",
      message:
        "Seguís con premium hasta el 4 de diciembre. Después pasás al plan free y no se te cobra más.",
    });
    expect(alerts.last().buttons.map((button) => button.text)).toEqual([
      "Volver",
      "Cancelar suscripción",
    ]);

    // Paso 2 de 2.
    await alerts.press("Cancelar suscripción");
    expect(posts("/billing/cancel")).toHaveLength(1);
    expect(
      await screen.findByText(
        "Cancelaste la suscripción. Seguís con premium hasta el 4 de diciembre.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText("Premium hasta el 4 de diciembre")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Cancelaste la suscripción: no se renueva ni se te cobra más. Desde el 4 de diciembre pasás al plan free, con 40 análisis por mes.",
      ),
    ).toBeOnTheScreen();
  });

  it("Volver en el diálogo no cancela nada", async () => {
    const alerts = spyAlerts();
    await start("/plan", [premium()]);

    await press("Cancelar suscripción");
    await alerts.press("Volver");
    expect(posts("/billing/cancel")).toHaveLength(0);
    expect(screen.getByText("Se renueva el 4 de diciembre por US$ 4,99.")).toBeOnTheScreen();
  });

  it("si falla, lo dice y la suscripción sigue como estaba", async () => {
    const alerts = spyAlerts();
    await start("/plan", [premium()], { cancel: () => apiError(503, "SERVICE_UNAVAILABLE") });

    await press("Cancelar suscripción");
    await alerts.press("Cancelar suscripción");
    expect(
      await screen.findByText(
        "No pudimos cancelar ahora. Probá de nuevo en unos minutos; tu suscripción sigue como estaba.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText("Se renueva el 4 de diciembre por US$ 4,99.")).toBeOnTheScreen();
  });

  it("cancelada y vigente: volver a activarla dice cuándo y cuánto se cobra, sin otro checkout", async () => {
    const alerts = spyAlerts();
    await start("/plan", [premium(false)], {
      subscribe: () => json(200, { action: "reactivated", plan: premium(true) }),
    });

    await press("Volver a activar la suscripción");
    expect(alerts.last().message).toBe(
      "La suscripción se renueva el 4 de diciembre por US$ 4,99 y después cada mes. Hoy no se cobra nada.",
    );
    await alerts.press("Activar");
    expect(
      await screen.findByText("Listo: tu suscripción se renueva el 4 de diciembre."),
    ).toBeOnTheScreen();
    expect(openAuthSession).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancelar suscripción" })).toBeOnTheScreen();
  });
});

describe("rutas de Tu plan según el interruptor de pagos", () => {
  describe.each([["true"], [undefined]])("prendido (%p)", (value) => {
    billingSwitch(value);

    it("/plan abre Tu plan", async () => {
      const router = await start("/plan", [free()]);

      expect(await screen.findByText("Te quedan 37 de 40 análisis este mes")).toBeOnTheScreen();
      expect(router.getPathname()).toBe("/plan");
    });

    it("billing/return lleva a Tu plan", async () => {
      const router = await start("/billing/return?result=cancel", [free()]);

      expect(await screen.findByText("Te quedan 37 de 40 análisis este mes")).toBeOnTheScreen();
      expect(router.getPathname()).toBe("/plan");
    });
  });

  describe("apagado (build de Google Play)", () => {
    billingSwitch("false");

    it.each(["/plan", "/plan?checkout=success", "/billing/return?result=success"])(
      "%s lleva al inicio, sin mostrar planes",
      async (url) => {
        const router = await start(url, [free()]);

        await act(() => jest.advanceTimersByTimeAsync(10));
        expect(router.getPathname()).toBe("/");
        expect(appRoutes(router)).not.toContain("plan");
        expect(screen.queryByRole("header", { name: "Tu plan" })).toBeNull();
        expectNoPaymentText();
      },
    );
  });
});

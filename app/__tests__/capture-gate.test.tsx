import type React from "react";
import type ReactNative from "react-native";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { PLAN_CHECK_TIMEOUT_MS } from "@/features/billing/captureGate";
import type { BillingPlan } from "@/services/billing";
import { createHttpClient } from "@/services/http-client";
import type { HttpClient } from "@/services/http-client";
import {
  BASE_URL,
  NEW_TOKENS,
  OLD_TOKENS,
  apiError,
  fakeFetch,
  json,
  memoryStorage,
} from "@/test-utils/fake-api";
import type { Call } from "@/test-utils/fake-api";

jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hide: jest.fn(),
}));

jest.mock("expo-localization", () => ({
  getCalendars: () => [{ timeZone: "America/Montevideo" }],
}));

// La cámara de verdad tiene sus propios tests: acá solo importa si se llega a abrir.
jest.mock("@/features/meals/CaptureScreen", () => {
  const { createElement } = jest.requireActual<typeof React>("react");
  const { Text } = jest.requireActual<typeof ReactNative>("react-native");
  return { __esModule: true, default: () => createElement(Text, null, "Cámara abierta") };
});

// Rutas, store y cliente HTTP reales; solo se reemplazan SecureStore y la red.
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

// 9 de noviembre a las 12:00 en Montevideo.
const NOW = new Date("2026-11-09T15:00:00.000Z");

const free = (remaining: number): BillingPlan => ({
  tier: "free",
  periodEnd: null,
  renews: false,
  analyses: { limit: 40, remaining, resetsOn: "2026-12-01" },
});

const PREMIUM: BillingPlan = {
  tier: "premium",
  periodEnd: "2026-12-04T15:00:00.000Z",
  renews: true,
  analyses: { limit: null, remaining: null, resetsOn: null },
};

let calls: Call[];

/**
 * Cada `GET /billing/plan` responde con el siguiente de `plans` (el último se repite); un Response
 * se devuelve tal cual y `"hang"` no responde nunca (hasta que se cancela el pedido).
 */
function start(initialUrl: string, plans: (BillingPlan | Response | "hang")[]) {
  const queue = [...plans];
  mockTokenStorage = memoryStorage(OLD_TOKENS);
  const fake = fakeFetch((call) => {
    if (call.path === "/auth/refresh") return json(200, { ...NEW_TOKENS });
    if (call.path.startsWith("/meals?")) return json(200, { items: [], nextCursor: null });
    if (call.path === "/billing/plan") {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Response) return next;
      return json(200, next);
    }
    return apiError(404, "NOT_FOUND");
  });
  calls = fake.calls;
  const fetch = (url: string, init: RequestInit) => {
    const hangs = url.endsWith("/billing/plan") && queue[0] === "hang";
    const response = fake.fetch(url, init);
    if (!hangs) return response;
    return new Promise<Response>((_, reject) =>
      init.signal?.addEventListener("abort", () => reject(new Error("abortado"))),
    );
  };
  mockApi = createHttpClient({ baseUrl: BASE_URL, storage: mockTokenStorage, fetch });
  return renderRouter("./src/app", { initialUrl });
}

const planGets = () => calls.filter((call) => call.path === "/billing/plan");
/** El botón del medio de la barra. */
const register = async () => fireEvent.press(await screen.findByTestId("tab-action"));
const press = async (name: string) => fireEvent.press(await screen.findByRole("button", { name }));
const settle = () => act(() => jest.advanceTimersByTimeAsync(10));
/** La hoja que reemplaza a la cámara cuando no quedan análisis. */
const sheet = () => screen.queryByTestId("sheet");
const QUOTA_TITLE = "Usaste los 40 análisis de este mes";
/** La barra y lo de detrás de la hoja no son para el lector de pantalla, pero se pueden tocar. */
const hidden = { includeHiddenElements: true };
/** Espera a que la barra tenga el plan, para que el toque decida con él. */
const planLoaded = async (count = 1) => {
  await waitFor(() => expect(planGets()).toHaveLength(count));
  await settle();
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Registrar con análisis disponibles", () => {
  it.each([
    ["free con análisis", free(37)],
    ["free con el último", free(1)],
    ["premium", PREMIUM],
  ])("%s: abre la cámara sin avisar ni esperar otro pedido", async (_name, plan) => {
    const router = await start("/", [plan]);
    await planLoaded();

    await register();

    expect(await screen.findByText("Cámara abierta")).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/capture");
    expect(sheet()).toBeNull();
    expect(planGets()).toHaveLength(1);
  });
});

describe("Registrar sin análisis", () => {
  it("no abre la cámara: avisa con calma cuándo se renuevan y ofrece ver los planes", async () => {
    const router = await start("/", [free(0)]);
    await planLoaded();

    await register();

    expect(await screen.findByRole("header", { name: QUOTA_TITLE })).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Se renuevan el 1 de diciembre. Tu historial y tus metas siguen disponibles.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("progress-fill", hidden)).toHaveStyle({ width: "100%" });
    // Las dos salidas a la vista; tocar afuera no suma un tercer botón para el lector de pantalla.
    expect(screen.getByRole("button", { name: "Ver planes" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/");
    expect(screen.queryByText("Cámara abierta")).toBeNull();
  });

  it("Ver planes lleva a Tu plan, y Volver vuelve adonde estaba", async () => {
    const router = await start("/", [free(0)]);
    await planLoaded();

    await register();
    await press("Ver planes");

    expect(await screen.findByRole("header", { name: "Tu plan" })).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/plan");
    expect(sheet()).toBeNull();
    await press("Volver");
    expect(router.getPathname()).toBe("/");
  });

  it.each([
    ["Cerrar", () => press("Cerrar")],
    [
      "tocar afuera",
      async () => fireEvent.press(await screen.findByTestId("sheet-backdrop", hidden)),
    ],
    [
      "el atrás de Android",
      async () => fireEvent(await screen.findByTestId("sheet"), "requestClose"),
    ],
  ])("%s deja todo como estaba, y Registrar vuelve a avisar", async (_name, dismiss) => {
    const router = await start("/", [free(0)]);
    await planLoaded();

    await register();
    await screen.findByRole("header", { name: QUOTA_TITLE });
    await dismiss();

    expect(sheet()).toBeNull();
    expect(router.getPathname()).toBe("/");
    expect(screen.queryByText("Cámara abierta")).toBeNull();

    await register();
    expect(await screen.findByRole("header", { name: QUOTA_TITLE })).toBeOnTheScreen();
  });

  it.each([
    ["el inicio", "/"],
    ["el historial", "/history"],
  ])("lo mismo con Registrar comida desde %s", async (_name, url) => {
    const router = await start(url, [free(0)]);
    await planLoaded();

    await press("Registrar comida");

    expect(await screen.findByRole("header", { name: QUOTA_TITLE })).toBeOnTheScreen();
    expect(router.getPathname()).toBe(url);
  });

  it("dos toques seguidos, mientras confirma el plan, hacen un solo pedido", async () => {
    const router = await start("/", [free(0), "hang"]);
    await planLoaded();

    await register();
    await register();
    expect(planGets()).toHaveLength(2);

    await act(() => jest.advanceTimersByTimeAsync(PLAN_CHECK_TIMEOUT_MS));
    expect(router.getPathname()).toBe("/capture");
  });
});

describe("antes de frenar a alguien, confirma con el plan del momento", () => {
  it.each([
    ["pasó a premium", PREMIUM],
    ["empezó otro mes", free(40)],
  ])("%s: abre la cámara", async (_name, now) => {
    const router = await start("/", [free(0), now]);
    await planLoaded();

    await register();

    expect(await screen.findByText("Cámara abierta")).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/capture");
    expect(sheet()).toBeNull();
    expect(planGets()).toHaveLength(2);
  });

  it("si el plan no se puede saber, abre la cámara: el Backend frena la comida al enviarla", async () => {
    const router = await start("/", [apiError(503, "SERVICE_UNAVAILABLE")]);
    await planLoaded();

    await register();

    expect(await screen.findByText("Cámara abierta")).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/capture");
    expect(sheet()).toBeNull();
  });

  it("si el plan no llega a tiempo, abre la cámara igual", async () => {
    const router = await start("/", [free(0), "hang"]);
    await planLoaded();

    await register();
    await act(() => jest.advanceTimersByTimeAsync(PLAN_CHECK_TIMEOUT_MS - 100));
    expect(router.getPathname()).toBe("/");

    await act(() => jest.advanceTimersByTimeAsync(200));
    expect(await screen.findByText("Cámara abierta")).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/capture");
    expect(sheet()).toBeNull();
  });
});

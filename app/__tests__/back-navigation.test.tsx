import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { createHttpClient } from "@/services/http-client";
import type { HttpClient } from "@/services/http-client";
import type { ReadyMeal } from "@/services/meals";
import {
  BASE_URL,
  NEW_TOKENS,
  OLD_TOKENS,
  apiError,
  fakeFetch,
  json,
  memoryStorage,
} from "@/test-utils/fake-api";
import { mockHardwareBack } from "@/test-utils/hardware-back";
import { meal as values } from "@/test-utils/meals";

jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hide: jest.fn(),
}));

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

const MEAL: ReadyMeal = {
  ...values,
  id: "66f1a0000000000000000099",
  status: "ready",
  capturedAt: "2026-10-26T16:30:00Z",
  photoUrl: "https://fotos.test/m1",
  confidence: 0.8,
};

/**
 * Backend con lo justo para recorrer la app: la comida existe y aparece en la lista del día; el
 * resto (dashboard, perfil, resumen) responde 404 y cada pantalla muestra su estado de error.
 */
function start(initialUrl: string) {
  mockTokenStorage = memoryStorage(OLD_TOKENS);
  const fake = fakeFetch((call) => {
    if (call.path === "/auth/refresh") return json(200, { ...NEW_TOKENS });
    if (call.path.startsWith("/meals?")) return json(200, { items: [MEAL], nextCursor: null });
    if (call.path === `/meals/${MEAL.id}`) return json(200, MEAL);
    return apiError(404, "NOT_FOUND");
  });
  mockApi = createHttpClient({ baseUrl: BASE_URL, storage: mockTokenStorage, fetch: fake.fetch });
  return renderRouter("./src/app", { initialUrl });
}

const tab = async (name: string) => fireEvent.press(await screen.findByRole("tab", { name }));
const press = async (name: string | RegExp) =>
  fireEvent.press(await screen.findByRole("button", { name }));

describe("volver a la pantalla principal", () => {
  it("desde cada pestaña, con la pestaña Inicio", async () => {
    const router = await start("/");
    for (const [name, path] of [
      ["Historial", "/history"],
      ["Semana", "/wrapped"],
      ["Perfil", "/profile"],
    ]) {
      await tab(name);
      expect(router.getPathname()).toBe(path);
      await tab("Inicio");
      expect(router.getPathname()).toBe("/");
    }
  });

  it("desde el detalle y la corrección, con Volver, de a una pantalla", async () => {
    const router = await start("/history");
    await press(/Milanesa con puré/);
    expect(router.getPathname()).toBe(`/meals/${MEAL.id}`);
    await press("Corregir");
    expect(router.getPathname()).toBe(`/meals/${MEAL.id}/edit`);

    await press("Volver");
    expect(router.getPathname()).toBe(`/meals/${MEAL.id}`);
    await press("Volver");
    expect(router.getPathname()).toBe("/history");
    await tab("Inicio");
    expect(router.getPathname()).toBe("/");
  });

  it.each([
    ["el resultado de un análisis", `/meals/${MEAL.id}`],
    ["la corrección", `/meals/${MEAL.id}/edit`],
    ["el Wrapped de una semana", "/wrapped/2026-W43"],
  ])("abierta sola (un aviso o un link), Volver desde %s lleva al inicio", async (_name, url) => {
    const router = await start(url);
    await press("Volver");
    expect(router.getPathname()).toBe("/");
    expect(await screen.findByRole("button", { name: "Registrar comida" })).toBeOnTheScreen();
  });
});

describe("Ir al inicio", () => {
  it("desde un detalle abierto en otra pestaña, va a la pestaña Inicio", async () => {
    mockTokenStorage = memoryStorage(OLD_TOKENS);
    const fake = fakeFetch((call) => {
      if (call.path === "/auth/refresh") return json(200, { ...NEW_TOKENS });
      if (call.path.startsWith("/meals?")) return json(200, { items: [MEAL], nextCursor: null });
      // La comida se borró en otro lado: el detalle muestra el 404 con "Ir al inicio".
      return apiError(404, "NOT_FOUND");
    });
    mockApi = createHttpClient({ baseUrl: BASE_URL, storage: mockTokenStorage, fetch: fake.fetch });
    const router = await renderRouter("./src/app", { initialUrl: "/history" });

    await press(/Milanesa con puré/);
    await press("Ir al inicio");
    expect(router.getPathname()).toBe("/");
    expect(await screen.findByRole("button", { name: "Registrar comida" })).toBeOnTheScreen();
  });
});

describe("el atrás de Android", () => {
  it.each([
    ["el resultado de un análisis", `/meals/${MEAL.id}`],
    ["el Wrapped de una semana", "/wrapped/2026-W43"],
  ])("en %s abierto solo hace lo mismo que Volver: no cierra la app", async (_name, url) => {
    const { pressBack, spy } = mockHardwareBack();
    const router = await start(url);
    await screen.findByRole("button", { name: "Volver" });

    expect(await pressBack()).toBe(true);
    expect(router.getPathname()).toBe("/");
    spy.mockRestore();
  });

  it("en el detalle vuelve a la pantalla de antes, como Volver", async () => {
    const { pressBack, spy } = mockHardwareBack();
    const router = await start("/history");
    await press(/Milanesa con puré/);
    await screen.findByRole("button", { name: "Volver" });

    expect(await pressBack()).toBe(true);
    expect(router.getPathname()).toBe("/history");
    spy.mockRestore();
  });

  it("en otra pestaña vuelve al inicio, y en el inicio deja que Android cierre la app", async () => {
    const { pressBack, spy } = mockHardwareBack();
    const router = await start("/");
    await tab("Perfil");

    expect(await pressBack()).toBe(true);
    expect(router.getPathname()).toBe("/");
    expect(await pressBack()).toBe(false);
    spy.mockRestore();
  });
});

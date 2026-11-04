import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { createHttpClient } from "@/services/http-client";
import type { HttpClient } from "@/services/http-client";
import type { Meal, ReadyMeal } from "@/services/meals";
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

// Rutas, store, cliente HTTP y polling reales; solo se reemplazan SecureStore y la red.
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

const MEAL_ID = "66f1a0000000000000000099";
const LOCAL_PHOTO = "file:///cache/ImageManipulator/comida.jpg";
const base = { id: MEAL_ID, capturedAt: "2026-10-26T13:05:00.000Z" };
const photoUrl = (n: number) => `https://media.test/photo.jpg?firma=${n}`;

const processing: Meal = { ...base, photoUrl: photoUrl(1), status: "processing" };
const ready: ReadyMeal = {
  ...base,
  photoUrl: photoUrl(1),
  status: "ready",
  dish: "Milanesa con puré",
  items: [
    { name: "Milanesa", grams: { min: 150, max: 190 }, kcal: { min: 380, max: 470 } },
    { name: "Puré de papa", grams: { min: 200, max: 200 }, kcal: { min: 180, max: 230 } },
  ],
  kcal: { min: 620, max: 780 },
  macros: { protein: { min: 38, max: 46 }, carbs: { min: 50, max: 65 }, fat: { min: 28, max: 38 } },
  confidence: 0.72,
  comment: { tone: "neutro", text: "Buena porción de proteína." },
};

let calls: Call[];
const mealGets = () => calls.filter((call) => call.path === `/meals/${MEAL_ID}`);

/** Abre el resultado con sesión; `meals` responde cada `GET /meals/:id` en orden (el último se repite). */
function start(meals: (() => Response)[], photo: string | null = LOCAL_PHOTO) {
  mockTokenStorage = memoryStorage(OLD_TOKENS);
  let index = 0;
  const fake = fakeFetch((call) => {
    if (call.path === "/auth/refresh") return json(200, { ...NEW_TOKENS });
    if (call.path === `/meals/${MEAL_ID}`) return meals[Math.min(index++, meals.length - 1)]();
    return apiError(404, "NOT_FOUND");
  });
  calls = fake.calls;
  mockApi = createHttpClient({ baseUrl: BASE_URL, storage: mockTokenStorage, fetch: fake.fetch });
  const query = photo ? `?photoUri=${encodeURIComponent(photo)}` : "";
  return renderRouter("./src/app", { initialUrl: `/meals/${MEAL_ID}${query}` });
}

const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));
const photo = () => screen.getByLabelText("Foto de tu comida");

describe("resultado de una comida", () => {
  it("analizando: la foto local al instante, el indicador y el skeleton; al estar lista, el análisis", async () => {
    await start([() => json(200, processing), () => json(200, ready)]);

    expect(await screen.findByText("Analizando tu comida…")).toBeOnTheScreen();
    expect(photo()).toHaveProp("source", { uri: LOCAL_PHOTO });

    await advance(1000);
    expect(await screen.findByText("620–780 kcal")).toBeOnTheScreen();
    expect(screen.queryByText("Analizando tu comida…")).toBeNull();
    expect(screen.getByText("Confianza media")).toBeOnTheScreen();
    expect(screen.getByText("Milanesa con puré")).toBeOnTheScreen();
    for (const [label, value] of [
      ["Proteínas", "38–46 g"],
      ["Carbohidratos", "50–65 g"],
      ["Grasas", "28–38 g"],
    ]) {
      expect(screen.getByText(label)).toBeOnTheScreen();
      expect(screen.getByText(value)).toBeOnTheScreen();
    }
    expect(screen.getByText("150–190 g · 380–470 kcal")).toBeOnTheScreen();
    // min = max: un solo número.
    expect(screen.getByText("200 g · 180–230 kcal")).toBeOnTheScreen();
    expect(screen.getByText("Comentario")).toBeOnTheScreen();
    expect(screen.getByText("“Buena porción de proteína.”")).toBeOnTheScreen();
    // La foto local se sigue usando: es la misma y no depende de la URL firmada.
    expect(photo()).toHaveProp("source", { uri: LOCAL_PHOTO });

    // Listo: no consulta más.
    const done = mealGets().length;
    await advance(60_000);
    expect(mealGets()).toHaveLength(done);
  });

  it("listo, sin comentario y con confianza baja", async () => {
    const { comment: _, ...withoutComment } = ready;
    await start([() => json(200, { ...withoutComment, confidence: 0.3 })]);

    expect(await screen.findByText("Confianza baja")).toBeOnTheScreen();
    expect(screen.queryByText(/“/)).toBeNull();
    expect(screen.queryByText("Comentario")).toBeNull();
  });

  it("fallido: mensaje tranquilo del error.code y una salida clara", async () => {
    const router = await start([
      () =>
        json(200, {
          ...base,
          photoUrl: photoUrl(1),
          status: "failed",
          error: { code: "NOT_FOOD" },
        }),
    ]);

    expect(await screen.findByText("No pudimos analizar esta foto")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "No encontramos comida en esta foto. Probá con otra en la que se vea el plato.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Sacar otra foto" })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Volver al inicio" }));
    expect(router.getPathname()).toBe("/");
  });

  it("fallido con un código desconocido usa el mensaje genérico", async () => {
    await start([
      () =>
        json(200, { ...base, photoUrl: photoUrl(1), status: "failed", error: { code: "OTRO" } }),
    ]);
    expect(
      await screen.findByText("No pudimos analizar esta comida. Probá de nuevo en un rato."),
    ).toBeOnTheScreen();
  });

  it("si no existe (404), lo dice y deja volver", async () => {
    await start([() => apiError(404, "NOT_FOUND")]);
    expect(await screen.findByText("No encontramos esta comida")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Volver al inicio" })).toBeOnTheScreen();
  });

  it("si la photoUrl venció, pide la comida de nuevo para tener una URL fresca", async () => {
    await start(
      [() => json(200, ready), () => json(200, { ...ready, photoUrl: photoUrl(2) })],
      null,
    );
    await screen.findByText("620–780 kcal");
    expect(photo()).toHaveProp("source", { uri: photoUrl(1) });

    await fireEvent(photo(), "error");
    await advance(0);
    expect(mealGets()).toHaveLength(2);
    expect(photo()).toHaveProp("source", { uri: photoUrl(2) });

    // La URL nueva también se renueva una vez si falla; repetir el error con ella ya no pide más.
    await fireEvent(photo(), "error");
    await fireEvent(photo(), "error");
    await advance(0);
    expect(mealGets()).toHaveLength(3);
  });
});

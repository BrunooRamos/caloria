import { router as appRouter } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { Alert } from "react-native";
import type { AlertButton } from "react-native";
import { createHttpClient } from "@/services/http-client";
import type { HttpClient } from "@/services/http-client";
import type { Meal, MealCorrection, ReadyMeal } from "@/services/meals";
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
import { meal } from "@/test-utils/meals";

jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hide: jest.fn(),
}));

// Rutas, store, cliente HTTP, polling y editor reales; solo se reemplazan SecureStore y la red.
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
const ready: ReadyMeal = {
  id: MEAL_ID,
  capturedAt: "2026-10-26T13:05:00.000Z",
  photoUrl: "https://media.test/photo.jpg?firma=1",
  status: "ready",
  confidence: 0.72,
  ...meal,
};

/** El Backend real devuelve la comida con la corrección aplicada. */
const applied: Handler = (call) =>
  json(200, { ...ready, ...(JSON.parse(call.body as string) as MealCorrection) });

let calls: Call[];
const mealGets = () =>
  calls.filter((call) => call.method === "GET" && call.path === `/meals/${MEAL_ID}`);
const patches = () => calls.filter((call) => call.method === "PATCH");
const patchBody = () => JSON.parse(patches()[0].body as string) as MealCorrection;

function start({
  current = ready as Meal,
  patch = applied,
  url = `/meals/${MEAL_ID}`,
}: { current?: Meal; patch?: Handler; url?: string } = {}) {
  mockTokenStorage = memoryStorage(OLD_TOKENS);
  const fake = fakeFetch((call) => {
    if (call.path === "/auth/refresh") return json(200, { ...NEW_TOKENS });
    if (call.path === `/meals/${MEAL_ID}`) {
      return call.method === "PATCH" ? patch(call) : json(200, current);
    }
    return apiError(404, "NOT_FOUND");
  });
  calls = fake.calls;
  mockApi = createHttpClient({ baseUrl: BASE_URL, storage: mockTokenStorage, fetch: fake.fetch });
  return renderRouter("./src/app", { initialUrl: url });
}

const advance = (ms = 0) => act(() => jest.advanceTimersByTimeAsync(ms));
const field = (label: string) => screen.getByLabelText(label);
const type = (label: string, text: string) => fireEvent.changeText(field(label), text);
const press = async (name: string) => fireEvent.press(screen.getByRole("button", { name }));
const saveButton = () => screen.getByRole("button", { name: "Guardar cambios" });

/** Del detalle a la corrección. */
async function openEditor(options?: Parameters<typeof start>[0]) {
  const router = await start(options);
  await screen.findByText("620–780 kcal");
  await press("Corregir");
  await screen.findByLabelText("Plato");
  return router;
}

async function save() {
  await press("Guardar cambios");
  await advance();
}

describe("corregir una comida", () => {
  it("guarda solo lo que cambió y el detalle muestra lo nuevo sin volver a pedir la comida", async () => {
    const router = await openEditor();
    expect(saveButton()).toBeDisabled();
    expect(router.getPathname()).toBe(`/meals/${MEAL_ID}/edit`);

    await type("Plato", "Milanesa napolitana con puré");
    await type("Kcal de Milanesa", "520");
    // Sin tocar el total, pasa a ser la suma de los ingredientes.
    expect(field("Calorías totales")).toHaveProp("placeholder", "700–750 kcal");
    expect(screen.getByText("Suma de los ingredientes.")).toBeOnTheScreen();
    expect(saveButton()).toBeEnabled();

    await save();
    expect(patches()).toHaveLength(1);
    expect(patchBody()).toEqual({
      dish: "Milanesa napolitana con puré",
      items: [
        { name: "Milanesa", grams: { min: 150, max: 190 }, kcal: { min: 520, max: 520 } },
        meal.items[1],
      ],
      kcal: { min: 700, max: 750 },
    });

    expect(router.getPathname()).toBe(`/meals/${MEAL_ID}`);
    expect(screen.getByText("Guardamos la corrección.")).toBeOnTheScreen();
    expect(await screen.findByText("Milanesa napolitana con puré")).toBeOnTheScreen();
    expect(screen.getByText("700–750 kcal")).toBeOnTheScreen();
    expect(screen.getByText("150–190 g · 520 kcal")).toBeOnTheScreen();
    expect(mealGets()).toHaveLength(1);
  });

  it("un valor que vuelve a como estaba no cuenta como cambio", async () => {
    await openEditor();
    await type("Kcal de Puré de papa", "200");
    expect(saveButton()).toBeEnabled();
    await type("Kcal de Puré de papa", "");
    expect(saveButton()).toBeDisabled();
    await type("Gramos de Puré de papa", "200");
    expect(saveButton()).toBeDisabled();
  });

  it("quitar un ingrediente se puede deshacer; al guardar, el total es la suma de lo que queda", async () => {
    await openEditor();
    await press("Quitar Milanesa");
    expect(screen.getByText("Quitaste Milanesa")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Nombre de Milanesa")).toBeNull();

    await press("Deshacer: volver a agregar Milanesa");
    expect(field("Nombre de Milanesa")).toBeOnTheScreen();
    expect(saveButton()).toBeDisabled();

    await press("Quitar Milanesa");
    await save();
    expect(patchBody()).toEqual({ items: [meal.items[1]], kcal: meal.items[1].kcal });
  });

  it("el total escrito a mano se respeta aunque cambien los ingredientes, y se puede volver a la suma", async () => {
    await openEditor();
    await type("Calorías totales", "800");
    await press("Quitar Milanesa");
    expect(
      screen.getByRole("button", { name: "Usar la suma de los ingredientes: 180–230 kcal" }),
    ).toBeOnTheScreen();

    await save();
    expect(patchBody()).toEqual({ items: [meal.items[1]], kcal: { min: 800, max: 800 } });
  });

  it("volver a la suma vacía el total", async () => {
    await openEditor();
    await type("Calorías totales", "800");
    await press("Quitar Milanesa");
    await press("Usar la suma de los ingredientes: 180–230 kcal");
    expect(field("Calorías totales")).toHaveProp("value", "");
    expect(field("Calorías totales")).toHaveProp("placeholder", "180–230 kcal");
  });

  it("el rango completo queda para quien lo quiera, con el mínimo que no pasa al máximo", async () => {
    await openEditor();
    await press("Gramos de Milanesa: usar mínimo y máximo");
    expect(field("Gramos de Milanesa, mínimo")).toHaveProp("value", "150");
    expect(field("Gramos de Milanesa, máximo")).toHaveProp("value", "190");

    await type("Gramos de Milanesa, máximo", "140");
    await fireEvent(field("Gramos de Milanesa, máximo"), "blur");
    expect(screen.getByText("No puede ser menor que el mínimo.")).toBeOnTheScreen();
    await press("Guardar cambios");
    expect(patches()).toHaveLength(0);

    await type("Gramos de Milanesa, máximo", "160");
    expect(screen.queryByText("No puede ser menor que el mínimo.")).toBeNull();
    await save();
    expect(patchBody().items?.[0].grams).toEqual({ min: 150, max: 160 });
  });

  it("los errores se ven en el campo al salir de él o al guardar, y no se manda nada", async () => {
    await openEditor();
    await type("Plato", " ");
    expect(screen.queryByText("Ingresá el nombre del plato.")).toBeNull();
    await fireEvent(field("Plato"), "blur");
    expect(screen.getByText("Ingresá el nombre del plato.")).toBeOnTheScreen();

    await type("Proteínas (g)", "-5");
    await type("Grasas (g)", "12,5");
    await press("Guardar cambios");
    expect(screen.getByText("No puede ser negativo.")).toBeOnTheScreen();
    expect(screen.getByText("Usá un número entero, sin comas ni puntos.")).toBeOnTheScreen();
    expect(patches()).toHaveLength(0);

    await type("Plato", "Milanesa");
    expect(screen.queryByText("Ingresá el nombre del plato.")).toBeNull();
  });

  it("agregar un ingrediente pide nombre, gramos y kcal, y suma sus kcal al total", async () => {
    await openEditor();
    await press("Agregar ingrediente");
    await press("Guardar cambios");
    expect(screen.getByText("Ingresá el nombre del ingrediente.")).toBeOnTheScreen();
    expect(screen.getByText("Ingresá los gramos.")).toBeOnTheScreen();
    expect(screen.getByText("Ingresá las kcal.")).toBeOnTheScreen();

    await type("Nombre de ingrediente nuevo", "Ensalada");
    await type("Gramos de Ensalada", "80");
    await type("Kcal de Ensalada", "30");
    await save();
    expect(patchBody()).toEqual({
      items: [
        ...meal.items,
        { name: "Ensalada", grams: { min: 80, max: 80 }, kcal: { min: 30, max: 30 } },
      ],
      kcal: { min: 590, max: 730 },
    });
  });

  it("si la API falla, muestra el error y no pierde lo que se cargó", async () => {
    const router = await openEditor({ patch: () => apiError(503, "SERVICE_UNAVAILABLE") });
    await type("Plato", "Milanesa napolitana");
    await save();

    expect(
      screen.getByText("El servicio no está disponible ahora. Probá de nuevo en unos minutos."),
    ).toBeOnTheScreen();
    expect(field("Plato")).toHaveProp("value", "Milanesa napolitana");
    expect(saveButton()).toBeEnabled();
    expect(router.getPathname()).toBe(`/meals/${MEAL_ID}/edit`);
  });

  describe("salir con cambios sin guardar", () => {
    let buttons: AlertButton[] | undefined;
    beforeEach(() => {
      buttons = undefined;
      jest.spyOn(Alert, "alert").mockImplementation((_title, _message, options) => {
        buttons = options;
      });
    });
    afterEach(() => jest.restoreAllMocks());

    it("pregunta; Seguir editando se queda y Descartar vuelve sin guardar", async () => {
      const router = await openEditor();
      await type("Plato", "Milanesa napolitana");

      await act(() => appRouter.back());
      expect(Alert.alert).toHaveBeenCalledWith(
        "¿Descartar los cambios?",
        "Lo que corregiste no se va a guardar.",
        expect.any(Array),
        expect.objectContaining({ cancelable: true }),
      );
      expect(buttons?.map((button) => button.text)).toEqual(["Seguir editando", "Descartar"]);
      // No es una acción destructiva: no va en rojo.
      expect(buttons?.[1].style).toBeUndefined();
      expect(router.getPathname()).toBe(`/meals/${MEAL_ID}/edit`);

      await act(() => appRouter.back());
      await act(() => buttons?.[1].onPress?.());
      expect(router.getPathname()).toBe(`/meals/${MEAL_ID}`);
      expect(await screen.findByText("Milanesa con puré")).toBeOnTheScreen();
      expect(patches()).toHaveLength(0);
    });

    it("sin cambios sale sin preguntar", async () => {
      const router = await openEditor();
      await act(() => appRouter.back());
      expect(Alert.alert).not.toHaveBeenCalled();
      expect(router.getPathname()).toBe(`/meals/${MEAL_ID}`);
    });
  });

  describe("solo se corrige una comida lista", () => {
    it("mientras se analiza, el detalle no ofrece corregir", async () => {
      await start({ current: { ...ready, status: "processing" } as Meal });
      expect(await screen.findByText("Analizando tu comida…")).toBeOnTheScreen();
      expect(screen.queryByRole("button", { name: "Corregir" })).toBeNull();
    });

    it("abierta directo, una comida en processing no se puede editar", async () => {
      const { id, capturedAt, photoUrl } = ready;
      await start({
        current: { id, capturedAt, photoUrl, status: "processing" },
        url: `/meals/${MEAL_ID}/edit`,
      });
      expect(await screen.findByText("Todavía no se puede corregir")).toBeOnTheScreen();
      expect(screen.queryByLabelText("Plato")).toBeNull();
    });

    it("abierta directo, una comida lista se pide y se puede editar", async () => {
      await start({ url: `/meals/${MEAL_ID}/edit` });
      expect(await screen.findByLabelText("Plato")).toHaveProp("value", "Milanesa con puré");
      expect(mealGets()).toHaveLength(1);
    });
  });
});

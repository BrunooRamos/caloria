import { router as appRouter } from "expo-router";
import { act, fireEvent, renderRouter, screen, within } from "expo-router/testing-library";
import { StyleSheet } from "react-native";
import { createHttpClient } from "@/services/http-client";
import type { HttpClient } from "@/services/http-client";
import type { DailyDashboard } from "@/services/dashboard";
import { colors } from "@/theme";
import {
  BASE_URL,
  NEW_TOKENS,
  OLD_TOKENS,
  apiError,
  deferred,
  fakeFetch,
  json,
  memoryStorage,
} from "@/test-utils/fake-api";
import type { Call } from "@/test-utils/fake-api";

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

const range = (min: number, max: number) => ({ min, max, mid: (min + max) / 2 });

const day: DailyDashboard = {
  date: "2026-10-26",
  consumed: {
    kcal: { min: 1450, max: 1820, mid: 1635 },
    protein: { min: 80, max: 102, mid: 91 },
    carbs: { min: 150, max: 190, mid: 170 },
    fat: { min: 45, max: 60, mid: 53 },
  },
  targets: { kcal: 2100, proteinG: 120, carbsG: 240, fatG: 70 },
  meals: { ready: 3, processing: 0, failed: 0 },
};

const emptyDay: DailyDashboard = {
  ...day,
  consumed: { kcal: range(0, 0), protein: range(0, 0), carbs: range(0, 0), fat: range(0, 0) },
  meals: { ready: 0, processing: 0, failed: 0 },
};

let calls: Call[];
const dashboardGets = () => calls.filter((call) => call.path === "/dashboard/daily");

function start(responses: (() => Response | Promise<Response>)[]) {
  mockTokenStorage = memoryStorage(OLD_TOKENS);
  let index = 0;
  const fake = fakeFetch((call) => {
    if (call.path === "/auth/refresh") return json(200, { ...NEW_TOKENS });
    if (call.path === "/dashboard/daily") {
      return responses[Math.min(index++, responses.length - 1)]();
    }
    return apiError(404, "NOT_FOUND");
  });
  calls = fake.calls;
  mockApi = createHttpClient({ baseUrl: BASE_URL, storage: mockTokenStorage, fetch: fake.fetch });
  return renderRouter("./src/app", { initialUrl: "/" });
}

const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

/** Ancho del relleno de una barra, buscada por su accessibilityLabel. */
function fillOf(label: RegExp) {
  const bar = screen.getByLabelText(label);
  // La barra está oculta al lector de pantalla: el valor lo lee el accessibilityLabel.
  const fill = within(bar).getByTestId("progress-fill", { includeHiddenElements: true });
  return StyleSheet.flatten(fill.props.style);
}

type JsonNode = {
  props: { style?: unknown; refreshControl?: { props: { onRefresh(): void } } };
  children: (JsonNode | string)[] | null;
};

function hostNodes(): JsonNode[] {
  const nodes: JsonNode[] = [];
  const visit = (node: JsonNode | string) => {
    if (typeof node === "string") return;
    nodes.push(node);
    node.children?.forEach(visit);
  };
  const tree = screen.toJSON() as JsonNode | JsonNode[] | null;
  (Array.isArray(tree) ? tree : tree ? [tree] : []).forEach(visit);
  return nodes;
}

/** Todos los colores que se pintan en la pantalla (texto, fondos, bordes). */
function paintedColors(): Set<string> {
  const found = new Set<string>();
  for (const node of hostNodes()) {
    const style = (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
    for (const key of ["color", "backgroundColor", "borderColor"]) {
      if (typeof style[key] === "string") found.add(style[key].toUpperCase());
    }
  }
  return found;
}

/** El gesto de pull to refresh: el mock de ScrollView deja el RefreshControl en sus props. */
async function pullToRefresh() {
  const scroll = hostNodes().find((node) => node.props.refreshControl);
  if (!scroll?.props.refreshControl) throw new Error("La pantalla no tiene pull to refresh");
  const { onRefresh } = scroll.props.refreshControl.props;
  await act(async () => onRefresh());
}

describe("pantalla principal: progreso del día", () => {
  it("mientras carga muestra el esqueleto y el botón de registrar", async () => {
    const response = deferred<Response>();
    await start([() => response.promise]);

    expect(await screen.findByLabelText("Cargando tu día")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Registrar comida" })).toBeOnTheScreen();

    await act(async () => response.resolve(json(200, day)));
    expect(await screen.findByText("1.450–1.820")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Cargando tu día")).toBeNull();
  });

  it("las barras muestran el rango contra la meta y se llenan con el punto medio", async () => {
    await start([() => json(200, day)]);

    // kcal: la principal.
    expect(await screen.findByText("1.450–1.820")).toBeOnTheScreen();
    expect(screen.getByText("de 2.100 kcal")).toBeOnTheScreen();
    // Macros.
    expect(screen.getByText(/^80–102 g/)).toBeOnTheScreen();
    expect(screen.getByText(/^150–190 g/)).toBeOnTheScreen();
    expect(screen.getByText(/^45–60 g/)).toBeOnTheScreen();
    expect(screen.getByText("de 120 g")).toBeOnTheScreen();

    // El lector de pantalla lee el valor y la meta.
    const kcal = screen.getByLabelText(
      "Energía: entre 1450 y 1820 kilocalorías, de una meta de 2100 kilocalorías",
    );
    expect(kcal).toBeOnTheScreen();
    for (const label of [
      "Proteína: entre 80 y 102 gramos, de una meta de 120 gramos",
      "Carbohidratos: entre 150 y 190 gramos, de una meta de 240 gramos",
      "Grasas: entre 45 y 60 gramos, de una meta de 70 gramos",
    ]) {
      expect(screen.getByLabelText(label)).toBeOnTheScreen();
    }

    // Relleno = mid / meta.
    expect(fillOf(/^Energía/).width).toBe(`${(1635 / 2100) * 100}%`);
    expect(fillOf(/^Proteína/).width).toBe(`${(91 / 120) * 100}%`);
    expect(fillOf(/^Grasas/).width).toBe(`${(53 / 70) * 100}%`);

    // Pide el día sin date: el Backend usa hoy en la zona del usuario.
    expect(dashboardGets()[0].path).toBe("/dashboard/daily");
  });

  it("pasarse de la meta deja la barra completa, en el mismo color y sin ningún aviso (RNF-10)", async () => {
    await start([
      () =>
        json(200, {
          ...day,
          consumed: { ...day.consumed, kcal: { min: 2600, max: 3000, mid: 2800 } },
        }),
    ]);

    expect(await screen.findByText("2.600–3.000")).toBeOnTheScreen();
    const kcalFill = fillOf(/^Energía/);
    expect(kcalFill.width).toBe("100%");
    expect(kcalFill.backgroundColor).toBe(colors.primary);
    // Mismo color que una barra que no se pasa.
    expect(fillOf(/^Proteína/).backgroundColor).toBe(colors.primary);

    const painted = paintedColors();
    // El recorrido encuentra los colores de la pantalla: si no, el resto no probaría nada.
    expect(painted.has(colors.primary.toUpperCase())).toBe(true);
    expect(painted.has(colors.danger.toUpperCase())).toBe(false);
    expect(painted.has(colors.dangerSoft.toUpperCase())).toBe(false);
    expect(painted.has(colors.warning.toUpperCase())).toBe(false);
    expect(screen.queryByText(/pasaste|excedi|exceso|sobre la meta|demasiado/i)).toBeNull();
  });

  it("indica las comidas analizándose y vuelve a pedir hasta que no queda ninguna", async () => {
    await start([
      () => json(200, { ...day, meals: { ready: 2, processing: 1, failed: 0 } }),
      () => json(200, day),
    ]);

    expect(await screen.findByText("1 comida analizándose")).toBeOnTheScreen();
    expect(screen.getByText("El total se actualiza cuando termine el análisis.")).toBeOnTheScreen();
    expect(screen.getByLabelText("Analizando")).toBeOnTheScreen();
    expect(dashboardGets()).toHaveLength(1);

    await advance(1000);
    expect(dashboardGets()).toHaveLength(2);
    expect(await screen.findByText("1.450–1.820")).toBeOnTheScreen();
    expect(screen.queryByText(/analizándose/)).toBeNull();

    // Ya no hay comidas en processing: no pide más.
    await advance(60_000);
    expect(dashboardGets()).toHaveLength(2);
  });

  it("varias comidas analizándose, en plural", async () => {
    await start([() => json(200, { ...day, meals: { ready: 1, processing: 2, failed: 0 } })]);
    expect(await screen.findByText("2 comidas analizándose")).toBeOnTheScreen();
  });

  it("una comida que no se pudo analizar: aviso tranquilo, sin rojo", async () => {
    await start([() => json(200, { ...day, meals: { ready: 3, processing: 0, failed: 1 } })]);

    expect(await screen.findByText("1 comida no se pudo analizar")).toBeOnTheScreen();
    expect(paintedColors().has(colors.danger.toUpperCase())).toBe(false);
  });

  it("día sin comidas: mensaje neutral, las barras en cero y el botón de registrar", async () => {
    await start([() => json(200, emptyDay)]);

    expect(await screen.findByText("Todavía no hay comidas hoy")).toBeOnTheScreen();
    expect(
      screen.getByText("Cuando registres una, vas a ver acá cómo va tu día."),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Energía: 0 kilocalorías/)).toBeOnTheScreen();
    expect(fillOf(/^Energía/).width).toBe("0%");
    expect(screen.getByRole("button", { name: "Registrar comida" })).toBeOnTheScreen();
  });

  it("si falla, muestra el error y deja reintentar; el botón de registrar sigue", async () => {
    await start([() => apiError(503, "SERVICE_UNAVAILABLE"), () => json(200, day)]);

    expect(
      await screen.findByText(
        "El servicio no está disponible ahora. Probá de nuevo en unos minutos.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Registrar comida" })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("1.450–1.820")).toBeOnTheScreen();
    expect(dashboardGets()).toHaveLength(2);
  });

  it("una respuesta con otra forma se muestra como error, sin romper la pantalla", async () => {
    await start([() => json(200, { hola: "mundo" })]);
    expect(await screen.findByText("Algo salió mal. Probá de nuevo.")).toBeOnTheScreen();
  });

  it("vuelve a pedir el dashboard cada vez que la pantalla gana foco", async () => {
    const router = await start([
      () => json(200, day),
      () =>
        json(200, {
          ...day,
          consumed: { ...day.consumed, kcal: { min: 2000, max: 2300, mid: 2150 } },
        }),
    ]);
    expect(await screen.findByText("1.450–1.820")).toBeOnTheScreen();
    expect(dashboardGets()).toHaveLength(1);

    // Ir a otra pantalla (registrar, corregir o borrar) y volver.
    await fireEvent.press(screen.getByText("Mi perfil"));
    expect(router.getPathname()).toBe("/profile");
    expect(dashboardGets()).toHaveLength(1);

    await act(() => appRouter.back());
    expect(router.getPathname()).toBe("/");
    expect(await screen.findByText("2.000–2.300")).toBeOnTheScreen();
    expect(dashboardGets()).toHaveLength(2);
  });

  it("si un refresco falla, deja lo que ya había y lo dice", async () => {
    await start([() => json(200, day), () => apiError(503, "SERVICE_UNAVAILABLE")]);
    expect(await screen.findByText("1.450–1.820")).toBeOnTheScreen();

    await pullToRefresh();
    expect(
      await screen.findByText("No pudimos actualizar. Estás viendo lo último que cargó."),
    ).toBeOnTheScreen();
    expect(screen.getByText("1.450–1.820")).toBeOnTheScreen();
  });

  it("pull to refresh vuelve a pedir el dashboard", async () => {
    await start([
      () => json(200, day),
      () =>
        json(200, {
          ...day,
          consumed: { ...day.consumed, kcal: { min: 1500, max: 1900, mid: 1700 } },
        }),
    ]);
    expect(await screen.findByText("1.450–1.820")).toBeOnTheScreen();

    await pullToRefresh();
    expect(await screen.findByText("1.500–1.900")).toBeOnTheScreen();
    expect(dashboardGets()).toHaveLength(2);
  });
});

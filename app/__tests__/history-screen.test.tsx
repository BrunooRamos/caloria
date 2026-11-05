import { router as appRouter } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { createHttpClient } from "@/services/http-client";
import type { HttpClient } from "@/services/http-client";
import type { Meal, MealListResponse } from "@/services/meals";
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
import { spyAlerts } from "@/test-utils/alert";
import type { Call, Handler } from "@/test-utils/fake-api";

jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hide: jest.fn(),
}));

// El día y las horas se calculan en la zona del usuario.
jest.mock("expo-localization", () => ({
  getCalendars: () => [{ timeZone: "America/Montevideo" }],
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

// 2026-10-28 01:30 UTC: en Montevideo (UTC-3) todavía es el martes 27.
const NOW = new Date("2026-10-28T01:30:00Z");
const TODAY = "2026-10-27";

function meal(id: string, capturedAt: string, dish: string): Meal {
  return {
    id,
    status: "ready",
    capturedAt,
    photoUrl: `https://fotos.test/${id}`,
    dish,
    items: [],
    kcal: { min: 400, max: 500 },
    macros: {
      protein: { min: 20, max: 30 },
      carbs: { min: 40, max: 50 },
      fat: { min: 10, max: 15 },
    },
    confidence: 0.8,
  };
}

const BREAKFAST = meal("a1", "2026-10-27T11:05:00Z", "Tostadas con palta");
const LUNCH = meal("a2", "2026-10-27T16:30:00Z", "Milanesa con puré");
const DINNER = meal("a3", "2026-10-28T00:15:00Z", "Ensalada César");
const YESTERDAY = meal("b1", "2026-10-26T15:00:00Z", "Guiso de lentejas");

const page = (items: Meal[], nextCursor: string | null = null): MealListResponse => ({
  items,
  nextCursor,
});

let calls: Call[];
const listCalls = () => calls.filter((call) => call.path.startsWith("/meals?"));
const deleteCalls = () => calls.filter((call) => call.method === "DELETE");

/** Backend falso: `list` responde `GET /meals?…` y `remove` el `DELETE`. */
function start({
  list,
  remove = () => new Response(null, { status: 204 }),
  initialUrl = "/history",
}: {
  list: Handler;
  remove?: Handler;
  initialUrl?: string;
}) {
  mockTokenStorage = memoryStorage(OLD_TOKENS);
  const fake = fakeFetch((call) => {
    if (call.path === "/auth/refresh") return json(200, { ...NEW_TOKENS });
    if (call.path.startsWith("/meals?")) return list(call);
    if (call.method === "DELETE") return remove(call);
    if (call.path.startsWith("/meals/")) {
      const id = call.path.split("/").pop();
      return json(
        200,
        [BREAKFAST, LUNCH, DINNER, YESTERDAY].find((item) => item.id === id),
      );
    }
    if (call.path === "/dashboard/daily") return apiError(503, "SERVICE_UNAVAILABLE");
    return apiError(404, "NOT_FOUND");
  });
  calls = fake.calls;
  mockApi = createHttpClient({ baseUrl: BASE_URL, storage: mockTokenStorage, fetch: fake.fetch });
  return renderRouter("./src/app", { initialUrl });
}

/** Por día, con `?date=`; las páginas siguientes, por `cursor`. */
function byDay(
  days: Record<string, MealListResponse>,
  pages: Record<string, MealListResponse> = {},
) {
  return (call: Call) => {
    const query = new URLSearchParams(call.path.split("?")[1]);
    const cursor = query.get("cursor");
    if (cursor) return json(200, pages[cursor]);
    return json(200, days[query.get("date") ?? ""] ?? page([]));
  };
}

function dateOf(call: Call) {
  return new URLSearchParams(call.path.split("?")[1]).get("date");
}

/** El fin de la lista: el mock de FlatList deja `onEndReached` en las props. */
async function reachEnd() {
  await act(async () => fireEvent(screen.getByTestId("history-list"), "endReached"));
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("historial por día", () => {
  it("muestra las comidas de hoy, en la zona del usuario, en el orden de la API", async () => {
    await start({ list: byDay({ [TODAY]: page([BREAKFAST, LUNCH, DINNER]) }) });

    expect(await screen.findByText("Tostadas con palta")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Hoy" })).toBeOnTheScreen();
    expect(listCalls().map(dateOf)).toEqual([TODAY]);

    const rows = screen.getAllByRole("button", { name: /kcal$/ });
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual([
      "08:05, Tostadas con palta, 400–500 kcal",
      "13:30, Milanesa con puré, 400–500 kcal",
      "21:15, Ensalada César, 400–500 kcal",
    ]);
  });

  it("mientras carga muestra el esqueleto", async () => {
    const response = deferred<Response>();
    await start({ list: () => response.promise });

    expect(await screen.findByLabelText("Cargando las comidas")).toBeOnTheScreen();
    await act(async () => response.resolve(json(200, page([LUNCH]))));
    expect(await screen.findByText("Milanesa con puré")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Cargando las comidas")).toBeNull();
  });

  it("navega a días anteriores y vuelve hasta hoy, nunca al futuro", async () => {
    await start({ list: byDay({ [TODAY]: page([LUNCH]), "2026-10-26": page([YESTERDAY]) }) });
    expect(await screen.findByText("Milanesa con puré")).toBeOnTheScreen();

    const next = screen.getByRole("button", { name: "Día siguiente" });
    expect(next).toBeDisabled();

    await fireEvent.press(screen.getByRole("button", { name: "Día anterior" }));
    expect(await screen.findByText("Guiso de lentejas")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Ayer" })).toBeOnTheScreen();
    expect(screen.queryByText("Milanesa con puré")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Día anterior" }));
    expect(await screen.findByText("No hay comidas este día")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "domingo 25 de octubre" })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Día siguiente" }));
    await fireEvent.press(screen.getByRole("button", { name: "Día siguiente" }));
    expect(await screen.findByText("Milanesa con puré")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Día siguiente" })).toBeDisabled();

    expect(listCalls().map(dateOf)).toEqual([
      TODAY,
      "2026-10-26",
      "2026-10-25",
      "2026-10-26",
      TODAY,
    ]);
  });

  it("un día futuro en la ruta se trata como hoy", async () => {
    await start({ list: byDay({}), initialUrl: "/history?date=2026-11-02" });
    expect(await screen.findByText("Todavía no hay comidas hoy")).toBeOnTheScreen();
    expect(listCalls().map(dateOf)).toEqual([TODAY]);
  });

  it("si falla la carga, muestra el error y permite reintentar", async () => {
    let fail = true;
    await start({
      list: (call) =>
        fail ? apiError(503, "SERVICE_UNAVAILABLE") : byDay({ [TODAY]: page([LUNCH]) })(call),
    });
    expect(
      await screen.findByText(
        "El servicio no está disponible ahora. Probá de nuevo en unos minutos.",
      ),
    ).toBeOnTheScreen();

    fail = false;
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Milanesa con puré")).toBeOnTheScreen();
  });

  it("carga la página siguiente con el cursor al llegar al final", async () => {
    await start({
      list: byDay(
        { [TODAY]: page([BREAKFAST, LUNCH], "cursor-2") },
        { "cursor-2": page([DINNER]) },
      ),
    });
    expect(await screen.findByText("Milanesa con puré")).toBeOnTheScreen();

    await reachEnd();
    expect(await screen.findByText("Ensalada César")).toBeOnTheScreen();
    expect(listCalls().map((call) => call.path)).toEqual([
      `/meals?date=${TODAY}`,
      `/meals?date=${TODAY}&cursor=cursor-2`,
    ]);

    // Sin cursor no pide más.
    await reachEnd();
    expect(listCalls()).toHaveLength(2);
  });

  it("si la página siguiente falla, no reintenta sola y ofrece cargar más", async () => {
    let fail = true;
    await start({
      list: (call) =>
        call.path.includes("cursor=") && fail
          ? apiError(503, "SERVICE_UNAVAILABLE")
          : byDay({ [TODAY]: page([LUNCH], "cursor-2") }, { "cursor-2": page([DINNER]) })(call),
    });
    expect(await screen.findByText("Milanesa con puré")).toBeOnTheScreen();

    await reachEnd();
    expect(await screen.findByRole("button", { name: "Cargar más" })).toBeOnTheScreen();
    await reachEnd();
    expect(listCalls()).toHaveLength(2);

    fail = false;
    await fireEvent.press(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText("Ensalada César")).toBeOnTheScreen();
  });

  it("el error de la página siguiente no se arrastra a otro día", async () => {
    await start({
      list: (call) =>
        call.path.includes("cursor=")
          ? apiError(503, "SERVICE_UNAVAILABLE")
          : byDay({
              [TODAY]: page([LUNCH], "cursor-2"),
              "2026-10-26": page([YESTERDAY], "cursor-y"),
            })(call),
    });
    expect(await screen.findByText("Milanesa con puré")).toBeOnTheScreen();
    await reachEnd();
    expect(await screen.findByRole("button", { name: "Cargar más" })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Día anterior" }));
    expect(await screen.findByText("Guiso de lentejas")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });

  it("tocar una comida abre el detalle, y al volver la lista se actualiza", async () => {
    let lunch = LUNCH;
    const router = await start({ list: (call) => byDay({ [TODAY]: page([lunch]) })(call) });
    expect(await screen.findByText("Milanesa con puré")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: /Milanesa con puré/ }));
    expect(router.getPathname()).toBe(`/meals/${LUNCH.id}`);

    // Mientras tanto se corrigió (RF-06): al volver se ve el valor nuevo.
    lunch = { ...LUNCH, dish: "Milanesa napolitana" } as Meal;
    await act(() => appRouter.back());
    expect(router.getPathname()).toBe("/history");
    expect(await screen.findByText("Milanesa napolitana")).toBeOnTheScreen();
  });

  describe("eliminar, desde el detalle", () => {
    /** Lista de hoy que ya no trae lo borrado, como el servidor. */
    function todayWithout(deleted: Set<string>, meals: Meal[]) {
      return (call: Call) =>
        byDay({ [TODAY]: page(meals.filter((item) => !deleted.has(item.id))) })(call);
    }

    async function openLunch() {
      await fireEvent.press(await screen.findByRole("button", { name: /Milanesa con puré/ }));
      return screen.findByRole("button", { name: "Eliminar comida" });
    }

    it("pide confirmación, borra, avisa y vuelve al historial sin la comida", async () => {
      const deleted = new Set<string>();
      const router = await start({
        list: todayWithout(deleted, [BREAKFAST, LUNCH]),
        remove: (call) => {
          deleted.add(call.path.split("/").pop() ?? "");
          return new Response(null, { status: 204 });
        },
      });
      const alerts = spyAlerts();
      await fireEvent.press(await openLunch());
      expect(alerts.last()).toMatchObject({
        title: "¿Eliminar esta comida?",
        message: "Se borra con su foto y deja de sumar en el día. No se puede deshacer.",
      });
      expect(alerts.last().buttons.map((button) => button.text)).toEqual(["Cancelar", "Eliminar"]);
      expect(deleteCalls()).toHaveLength(0);

      await alerts.press("Eliminar");
      expect(deleteCalls().map((call) => call.path)).toEqual([`/meals/${LUNCH.id}`]);
      expect(await screen.findByText("Eliminamos la comida.")).toBeOnTheScreen();
      expect(router.getPathname()).toBe("/history");
      expect(await screen.findByText("Tostadas con palta")).toBeOnTheScreen();
      expect(screen.queryByText("Milanesa con puré")).toBeNull();
    });

    it("cancelar no borra nada", async () => {
      const router = await start({ list: byDay({ [TODAY]: page([LUNCH]) }) });
      const alerts = spyAlerts();
      await fireEvent.press(await openLunch());
      await alerts.press("Cancelar");
      expect(deleteCalls()).toHaveLength(0);
      expect(router.getPathname()).toBe(`/meals/${LUNCH.id}`);
    });

    it("si falla, lo dice y la comida queda", async () => {
      const router = await start({
        list: byDay({ [TODAY]: page([LUNCH]) }),
        remove: () => apiError(503, "SERVICE_UNAVAILABLE"),
      });
      const alerts = spyAlerts();
      await fireEvent.press(await openLunch());
      await alerts.press("Eliminar");
      expect(
        await screen.findByText(
          "El servicio no está disponible ahora. Probá de nuevo en unos minutos.",
        ),
      ).toBeOnTheScreen();
      expect(router.getPathname()).toBe(`/meals/${LUNCH.id}`);
      expect(screen.queryByText("Eliminamos la comida.")).toBeNull();
    });

    it("un 404 cuenta como borrada: ya no estaba", async () => {
      const router = await start({
        list: byDay({ [TODAY]: page([]) }),
        remove: () => apiError(404, "NOT_FOUND"),
        initialUrl: `/meals/${LUNCH.id}`,
      });
      const alerts = spyAlerts();
      await fireEvent.press(await screen.findByRole("button", { name: "Eliminar comida" }));
      await alerts.press("Eliminar");
      expect(await screen.findByText("Eliminamos la comida.")).toBeOnTheScreen();
      // Se abrió sola (como desde un link): vuelve al inicio.
      expect(router.getPathname()).toBe("/");
    });
  });

  it("es una pestaña: se llega desde cualquier sección y vuelve al día que estaba", async () => {
    const router = await start({
      list: byDay({ [TODAY]: page([LUNCH]), "2026-10-26": page([YESTERDAY]) }),
      initialUrl: "/",
    });
    await fireEvent.press(await screen.findByRole("tab", { name: "Historial" }));
    expect(router.getPathname()).toBe("/history");
    await fireEvent.press(await screen.findByRole("button", { name: "Día anterior" }));
    expect(await screen.findByText("Guiso de lentejas")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("tab", { name: "Perfil" }));
    expect(router.getPathname()).toBe("/profile");
    await fireEvent.press(screen.getByRole("tab", { name: "Historial" }));
    expect(await screen.findByText("Guiso de lentejas")).toBeOnTheScreen();
  });
});

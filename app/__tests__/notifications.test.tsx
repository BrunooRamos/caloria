import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { Linking } from "react-native";
import type { Profile } from "@/services/auth";
import { createHttpClient } from "@/services/http-client";
import type { HttpClient } from "@/services/http-client";
import type { Me, NotificationPreferences } from "@/services/users";
import {
  BASE_URL,
  NEW_TOKENS,
  apiError,
  deferred,
  fakeFetch,
  json,
  memoryStorage,
} from "@/test-utils/fake-api";
import type { Call, Handler } from "@/test-utils/fake-api";

// Helpers del mock manual de `__mocks__/expo-notifications.ts`.
const { mockNotifications, tapResponse } = jest.requireMock<{
  mockNotifications: {
    setPermission(permission: object): void;
    answerRequestWith(permission: object): void;
    setToken(token: string | Error): void;
    setLastResponse(response: unknown): void;
    tap(response: unknown): void;
    reset(): void;
  };
  tapResponse(data: Record<string, unknown>, identifier?: string): unknown;
}>("expo-notifications");

jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hide: jest.fn(),
}));

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

const GRANTED = { status: "granted", granted: true, canAskAgain: true };
const DENIED = { status: "denied", granted: false, canAskAgain: true };
const BLOCKED = { status: "denied", granted: false, canAskAgain: false };
const TOKEN = "ExponentPushToken[device-1]";
const MEAL_ID = "66f1a0000000000000000099";

const PROFILE: Profile = {
  sex: "female",
  birthDate: "2002-04-10",
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: "America/Montevideo",
};

const ALL_ON: NotificationPreferences = {
  analysisReady: true,
  streakRisk: true,
  wrappedReady: true,
};

const me = (notifications: NotificationPreferences = ALL_ON): Me => ({
  id: "u1",
  email: "cami@example.com",
  profile: PROFILE,
  targets: { kcal: 2093, proteinG: 108, carbsG: 285, fatG: 58 },
  tone: "neutro",
  plan: { tier: "free", since: "2026-10-14T19:00:00.000Z" },
  notifications,
});

let calls: Call[];

/** Sesión guardada: el refresh de arranque entra directo. */
function backend(patch: Handler = () => json(200, me())): Handler {
  return (call) => {
    if (call.path === "/auth/refresh") return json(200, { ...NEW_TOKENS });
    if (call.path === "/users/me" && call.method === "GET") return json(200, me());
    if (call.path === "/users/me" && call.method === "PATCH") return patch(call);
    return apiError(404, "NOT_FOUND");
  };
}

function start(handler: Handler, initialUrl: string) {
  mockTokenStorage = memoryStorage(NEW_TOKENS);
  const fake = fakeFetch(handler);
  calls = fake.calls;
  mockApi = createHttpClient({ baseUrl: BASE_URL, storage: mockTokenStorage, fetch: fake.fetch });
  return renderRouter("./src/app", { initialUrl });
}

const patches = () =>
  calls
    .filter((call) => call.path === "/users/me" && call.method === "PATCH")
    .map((call) => JSON.parse(String(call.body)) as object);

beforeEach(() => {
  mockNotifications.reset();
  jest.clearAllMocks();
});

describe("permiso y token", () => {
  it("con el permiso sin pedir, ofrece activarlo y al aceptar registra el token", async () => {
    await start(backend(), "/profile");

    await fireEvent.press(await screen.findByText("Activar avisos"));

    expect(
      await screen.findByText("Los avisos están activados en este teléfono."),
    ).toBeOnTheScreen();
    expect(screen.queryByText("Activar avisos")).not.toBeOnTheScreen();
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(patches()).toEqual([{ pushTokens: [TOKEN] }]);
  });

  it("si el usuario no acepta, no registra nada y deja volver a intentar", async () => {
    mockNotifications.answerRequestWith(DENIED);
    await start(backend(), "/profile");

    await fireEvent.press(await screen.findByText("Activar avisos"));

    expect(await screen.findByText("Activar avisos")).toBeOnTheScreen();
    expect(patches()).toEqual([]);
  });

  it("si el sistema ya no pregunta, manda a la configuración", async () => {
    mockNotifications.setPermission(BLOCKED);
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue();
    await start(backend(), "/profile");

    await fireEvent.press(await screen.findByText("Abrir configuración"));

    expect(openSettings).toHaveBeenCalled();
    expect(screen.queryByText("Activar avisos")).not.toBeOnTheScreen();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("si Expo no da el token, lo dice, no manda nada y deja reintentar", async () => {
    mockNotifications.setToken(new Error("ERR_NOTIFICATIONS_NO_EXPERIENCE_ID"));
    await start(backend(), "/profile");

    await fireEvent.press(await screen.findByText("Activar avisos"));

    expect(
      await screen.findByText("No pudimos activar los avisos en este teléfono. Probá de nuevo."),
    ).toBeOnTheScreen();
    expect(
      screen.queryByText("Los avisos están activados en este teléfono."),
    ).not.toBeOnTheScreen();
    expect(patches()).toEqual([]);

    // El permiso ya está dado: el reintento solo vuelve a registrar el token.
    mockNotifications.setToken(TOKEN);
    await fireEvent.press(screen.getByText("Reintentar"));

    expect(
      await screen.findByText("Los avisos están activados en este teléfono."),
    ).toBeOnTheScreen();
    expect(patches()).toEqual([{ pushTokens: [TOKEN] }]);
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it("con el permiso ya dado, al entrar registra el token sin preguntar", async () => {
    mockNotifications.setPermission(GRANTED);
    await start(backend(), "/");

    await act(() => Promise.resolve());

    expect(patches()).toEqual([{ pushTokens: [TOKEN] }]);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("sin permiso, al entrar no pregunta ni registra nada", async () => {
    await start(backend(), "/");

    await act(() => Promise.resolve());

    expect(patches()).toEqual([]);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe("preferencias", () => {
  it("cada interruptor manda solo su tipo y se guarda al tocarlo", async () => {
    const response = deferred<Response>();
    await start(
      backend(() => response.promise),
      "/profile",
    );

    const streak = await screen.findByRole("switch", { name: "Racha en riesgo" });
    expect(streak).toBeChecked();
    await fireEvent.press(streak);

    // Mientras guarda ya se ve apagado y no se puede tocar otro.
    expect(screen.getByRole("switch", { name: "Racha en riesgo" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Comida analizada" })).toBeDisabled();
    expect(patches()).toEqual([{ notifications: { streakRisk: false } }]);

    await act(async () => response.resolve(json(200, me({ ...ALL_ON, streakRisk: false }))));

    expect(screen.getByRole("switch", { name: "Racha en riesgo" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Comida analizada" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Resumen semanal" })).toBeEnabled();
  });

  it("muestra lo guardado y, si falla, vuelve atrás y lo dice", async () => {
    await start(
      (call) =>
        call.path === "/users/me" && call.method === "GET"
          ? json(200, me({ ...ALL_ON, wrappedReady: false }))
          : backend(() => apiError(503, "SERVICE_UNAVAILABLE"))(call),
      "/profile",
    );

    const wrapped = await screen.findByRole("switch", { name: "Resumen semanal" });
    expect(wrapped).not.toBeChecked();
    await fireEvent.press(wrapped);

    expect(await screen.findByRole("alert")).toBeOnTheScreen();
    expect(screen.getByRole("switch", { name: "Resumen semanal" })).not.toBeChecked();
    expect(patches()).toEqual([{ notifications: { wrappedReady: true } }]);
  });
});

describe("tocar un aviso", () => {
  it("el aviso que abrió la app lleva a esa comida", async () => {
    mockNotifications.setLastResponse(tapResponse({ type: "analysisReady", mealId: MEAL_ID }));
    await start(backend(), "/");

    await waitFor(() => expect(screen).toHavePathname(`/meals/${MEAL_ID}`));
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();
  });

  it("si el aviso que abrió la app llega también por el listener, navega una sola vez", async () => {
    const response = tapResponse({ type: "analysisReady", mealId: MEAL_ID });
    mockNotifications.setLastResponse(response);
    await start(backend(), "/");
    await waitFor(() => expect(screen).toHavePathname(`/meals/${MEAL_ID}`));

    await act(async () => mockNotifications.tap(response));

    // Un solo push: al volver se llega al inicio, no a otra copia de la comida.
    await act(async () => router.back());
    expect(screen).toHavePathname("/");
  });

  it("con la app abierta, cada toque del mismo aviso abre esa comida", async () => {
    await start(backend(), "/");
    await act(() => Promise.resolve());

    const response = tapResponse({ type: "analysisReady", mealId: MEAL_ID });
    await act(async () => mockNotifications.tap(response));
    expect(screen).toHavePathname(`/meals/${MEAL_ID}`);

    await act(async () => router.back());
    expect(screen).toHavePathname("/");

    await act(async () => mockNotifications.tap(response));
    expect(screen).toHavePathname(`/meals/${MEAL_ID}`);
  });

  it("si no se tocó el aviso sino una acción, no navega", async () => {
    await start(backend(), "/");
    await act(() => Promise.resolve());

    await act(async () =>
      mockNotifications.tap({
        ...(tapResponse({ type: "analysisReady", mealId: MEAL_ID }) as object),
        actionIdentifier: "expo.modules.notifications.actions.DISMISS",
      }),
    );

    expect(screen).toHavePathname("/");
  });
});

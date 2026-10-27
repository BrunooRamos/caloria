import * as SplashScreen from "expo-splash-screen";
import type * as React from "react";
import type * as LoginScreenModule from "@/features/auth/LoginScreen";
import type * as SessionDebugModule from "@/features/auth/SessionDebug";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { createHttpClient } from "@/services/http-client";
import type { HttpClient } from "@/services/http-client";
import type { AuthTokens } from "@/services/token-storage";
import { STARTUP_REFRESH_TIMEOUT_MS } from "@/store/session";
import {
  BASE_URL,
  NEW_TOKENS,
  OLD_TOKENS,
  apiError,
  deferred,
  fakeFetch,
  json,
  memoryStorage,
  rotatingBackend,
} from "@/test-utils/fake-api";
import type { Call, Handler } from "@/test-utils/fake-api";

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

// Cuenta los renders del login y de la home para comprobar que nunca aparece la pantalla equivocada.
const mockRenders = { login: 0, home: 0 };
jest.mock("@/features/auth/LoginScreen", () => {
  const { createElement } = jest.requireActual<typeof React>("react");
  const actual = jest.requireActual<typeof LoginScreenModule>("@/features/auth/LoginScreen");
  return {
    __esModule: true,
    default: () => {
      mockRenders.login += 1;
      return createElement(actual.default);
    },
  };
});
// La home renderiza SessionDebug en desarrollo (__DEV__ es true en Jest).
jest.mock("@/features/auth/SessionDebug", () => {
  const { createElement } = jest.requireActual<typeof React>("react");
  const actual = jest.requireActual<typeof SessionDebugModule>("@/features/auth/SessionDebug");
  return {
    SessionDebug: () => {
      mockRenders.home += 1;
      return createElement(actual.SessionDebug);
    },
  };
});

let calls: Call[];

function start(handler: Handler, tokens: AuthTokens | null) {
  mockTokenStorage = memoryStorage(tokens);
  const fake = fakeFetch(handler);
  calls = fake.calls;
  mockApi = createHttpClient({ baseUrl: BASE_URL, storage: mockTokenStorage, fetch: fake.fetch });
  return renderRouter("./src/app", { initialUrl: "/" });
}

/** Rutas del Stack raíz: muestra qué grupos llegaron a montarse. */
const rootRoutes = (router: Awaited<ReturnType<typeof start>>) =>
  router.getRouterState()?.routes[0]?.state?.routes.map((route) => route.name);

beforeEach(() => {
  jest.mocked(SplashScreen.hide).mockClear();
  mockRenders.login = 0;
  mockRenders.home = 0;
});

describe("al abrir la app", () => {
  it("mantiene el splash mientras refresca y entra directo al grupo con sesión", async () => {
    const refreshResponse = deferred<Response>();
    const router = await start(
      rotatingBackend(() => refreshResponse.promise),
      OLD_TOKENS,
    );

    // Refresh en vuelo: no hay ninguna pantalla montada y el splash sigue arriba.
    expect(mockRenders).toEqual({ login: 0, home: 0 });
    expect(SplashScreen.hide).not.toHaveBeenCalled();

    await act(async () => refreshResponse.resolve(json(200, { ...NEW_TOKENS })));

    expect(await screen.findByText("Hoy")).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/");
    expect(rootRoutes(router)).toEqual(["(app)"]);
    // El login nunca llegó a renderizarse, ni siquiera por un frame.
    expect(mockRenders.login).toBe(0);
    expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
    expect(mockTokenStorage.current()).toEqual(NEW_TOKENS);
  });

  it("sin tokens guardados va al login sin llamar a la API", async () => {
    const router = await start(rotatingBackend(), null);

    expect(await screen.findByLabelText("Email")).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/login");
    expect(rootRoutes(router)).toEqual(["(auth)"]);
    expect(mockRenders.home).toBe(0);
    expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it("si el servidor rechaza el refresh, limpia y va al login", async () => {
    const router = await start(
      rotatingBackend(() => apiError(401, "UNAUTHORIZED")),
      OLD_TOKENS,
    );

    expect(await screen.findByLabelText("Email")).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/login");
    expect(mockRenders.home).toBe(0);
    expect(mockTokenStorage.current()).toBeNull();
  });

  it("si el refresh falla por red, entra con los tokens guardados", async () => {
    const router = await start(
      rotatingBackend(() => Promise.reject(new TypeError("Network request failed"))),
      OLD_TOKENS,
    );

    expect(await screen.findByText("Hoy")).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/");
    expect(mockTokenStorage.current()).toEqual(OLD_TOKENS);
  });

  it("si el refresh se cuelga, no deja el splash trabado y sigue en segundo plano", async () => {
    const refreshResponse = deferred<Response>();
    const router = await start(
      rotatingBackend(() => refreshResponse.promise),
      OLD_TOKENS,
    );
    expect(SplashScreen.hide).not.toHaveBeenCalled();

    await act(async () => jest.advanceTimersByTime(STARTUP_REFRESH_TIMEOUT_MS));
    expect(await screen.findByText("Hoy")).toBeOnTheScreen();
    expect(SplashScreen.hide).toHaveBeenCalledTimes(1);

    // El refresh termina después y el servidor lo rechaza: vuelve al login.
    await act(async () => refreshResponse.resolve(apiError(401, "UNAUTHORIZED")));
    expect(await screen.findByLabelText("Email")).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/login");
  });
});

describe("con la app abierta", () => {
  it("el login guarda los tokens y lleva a la home", async () => {
    const router = await start((call) => {
      if (call.path === "/auth/login") {
        return json(200, { ...NEW_TOKENS, user: { id: "u1", email: "cami@example.com" } });
      }
      return apiError(404, "NOT_FOUND");
    }, null);

    await fireEvent.changeText(await screen.findByLabelText("Email"), " cami@example.com ");
    await fireEvent.changeText(screen.getByLabelText("Contraseña"), "secreto123");
    await fireEvent.press(screen.getByText("Ingresar"));

    expect(await screen.findByText("Hoy")).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/");
    expect(calls[0].body).toBe(
      JSON.stringify({ email: "cami@example.com", password: "secreto123" }),
    );
    expect(mockTokenStorage.current()).toEqual(NEW_TOKENS);
  });

  it("el login y el registro se enlazan entre sí", async () => {
    const router = await start(rotatingBackend(), null);

    await fireEvent.press(await screen.findByText("Crear una cuenta"));
    expect(router.getPathname()).toBe("/register");

    await fireEvent.press(await screen.findByText("Ya tengo cuenta"));
    expect(router.getPathname()).toBe("/login");
  });

  it("muestra el error de la API si el login falla", async () => {
    const router = await start(() => apiError(401, "UNAUTHORIZED"), null);

    await fireEvent.changeText(await screen.findByLabelText("Email"), "cami@example.com");
    await fireEvent.changeText(screen.getByLabelText("Contraseña"), "incorrecta");
    await fireEvent.press(screen.getByText("Ingresar"));

    expect(await screen.findByText("El email o la contraseña no son correctos.")).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/login");
  });

  it("el logout desde el perfil pide confirmación y se puede cancelar", async () => {
    // Aunque el perfil no cargue, cerrar sesión sigue disponible.
    const backend = rotatingBackend();
    const router = await start(
      (call) => (call.path === "/users/me" ? apiError(404, "NOT_FOUND") : backend(call)),
      OLD_TOKENS,
    );

    await fireEvent.press(await screen.findByText("Mi perfil"));
    expect(router.getPathname()).toBe("/profile");

    await fireEvent.press(await screen.findByText("Cerrar sesión"));
    expect(screen.getByText("¿Querés cerrar la sesión?")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Cancelar"));

    expect(screen.getByText("Cerrar sesión")).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/profile");
    expect(calls.some((call) => call.path === "/auth/logout")).toBe(false);
    expect(mockTokenStorage.current()).toEqual(NEW_TOKENS);
  });

  it("el logout borra los tokens y vuelve al login aunque /auth/logout falle", async () => {
    const router = await start((call) => {
      if (call.path === "/auth/refresh") return json(200, { ...NEW_TOKENS });
      if (call.path === "/auth/logout") return apiError(500, "INTERNAL_ERROR");
      return apiError(404, "NOT_FOUND");
    }, OLD_TOKENS);

    await fireEvent.press(await screen.findByText("Mi perfil"));
    await fireEvent.press(await screen.findByText("Cerrar sesión"));
    await fireEvent.press(screen.getByText("Sí, cerrar sesión"));

    expect(await screen.findByLabelText("Email")).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/login");
    expect(mockTokenStorage.current()).toBeNull();
    const logout = calls.find((call) => call.path === "/auth/logout");
    expect(logout?.headers.Authorization).toBe("Bearer access-new");
    expect(logout?.body).toBe(JSON.stringify({ refreshToken: "refresh-2" }));
  });

  it("si la sesión expira en medio del uso, el cliente avisa al store y vuelve al login", async () => {
    let refreshes = 0;
    const router = await start(
      rotatingBackend(() =>
        refreshes++ === 0 ? json(200, { ...NEW_TOKENS }) : apiError(401, "UNAUTHORIZED"),
      ),
      OLD_TOKENS,
    );
    await screen.findByText("Hoy");

    // El access token vence y el backend ya no acepta el refresh token.
    await mockTokenStorage.set({ accessToken: "access-vencido", refreshToken: "refresh-2" });
    await fireEvent.press(screen.getByText("Probar 2 requests en paralelo (dev)"));

    expect(await screen.findByLabelText("Email")).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/login");
    expect(calls.filter((call) => call.path === "/auth/refresh")).toHaveLength(2);
  });
});

import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import * as Notifications from "expo-notifications";
import { createHttpClient } from "@/services/http-client";
import type { HttpClient } from "@/services/http-client";
import type { Me } from "@/services/users";
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

// La carpeta de cache del teléfono: fotos de la cámara, audios e imágenes del Wrapped.
const mockCache = { entries: [] as string[], deleted: [] as string[] };
jest.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache/" },
  Directory: class {
    list() {
      return mockCache.entries.map((name) => ({
        delete: () => {
          mockCache.deleted.push(name);
          // Uno que el sistema está usando no se puede borrar: no corta el resto.
          if (name === "en-uso") throw new Error("en uso");
        },
      }));
    }
  },
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

const me = (plan: Me["plan"] = { tier: "free", since: "2026-10-14T19:00:00.000Z" }): Me => ({
  id: "u1",
  email: "cami@example.com",
  profile: {
    sex: "female",
    birthDate: "2002-04-10",
    heightCm: 165,
    weightKg: 60,
    activity: "moderate",
    goal: "maintain",
    timezone: "America/Montevideo",
  },
  targets: { kcal: 2093, proteinG: 108, carbsG: 285, fatG: 58 },
  tone: "neutro",
  plan,
  notifications: { analysisReady: true, streakRisk: true, wrappedReady: true },
});

let calls: Call[];
const deletes = () => calls.filter((call) => call.method === "DELETE");

/** Backend con `GET /users/me` y la respuesta de cada `DELETE /users/me`, en orden. */
function backend(answers: (() => Response | Promise<Response>)[], profile = me()): Handler {
  const queue = [...answers];
  return (call) => {
    // Al abrir la app se renueva la sesión guardada.
    if (call.path === "/auth/refresh") return json(200, { ...NEW_TOKENS });
    if (call.path === "/users/me" && call.method === "GET") return json(200, profile);
    if (call.path === "/users/me" && call.method === "DELETE") {
      const next = queue.shift();
      if (!next) throw new Error("DELETE de más");
      return next();
    }
    if (call.path.startsWith("/meals")) return json(200, { items: [], nextCursor: null });
    return apiError(404, "NOT_FOUND");
  };
}

const deleted = () => new Response(null, { status: 204 });
const offline = () => Promise.reject(new TypeError("Network request failed"));

function start(handler: Handler, initialUrl = "/profile/delete") {
  mockTokenStorage = memoryStorage(OLD_TOKENS);
  const fake = fakeFetch(handler);
  calls = fake.calls;
  mockApi = createHttpClient({ baseUrl: BASE_URL, storage: mockTokenStorage, fetch: fake.fetch });
  return renderRouter("./src/app", { initialUrl });
}

const deleteButton = () => screen.findByRole("button", { name: "Eliminar mi cuenta" });
const typeWord = async (word: string) =>
  fireEvent.changeText(await screen.findByLabelText("Para confirmar, escribí ELIMINAR"), word);

beforeEach(() => {
  mockCache.entries = ["Camera", "ImageManipulator", "en-uso", "caloria-semana.png"];
  mockCache.deleted = [];
  jest.mocked(Notifications.dismissAllNotificationsAsync).mockClear();
});

describe("Eliminar cuenta", () => {
  it("está al final del perfil, sin llamar la atención, y abre la pantalla", async () => {
    const router = await start(backend([]), "/profile");

    await fireEvent.press(await screen.findByRole("button", { name: "Eliminar cuenta" }));

    expect(await screen.findByRole("header", { name: "Eliminar cuenta" })).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/profile/delete");
  });

  it("explica qué se borra y que no se recupera, y pide escribir ELIMINAR", async () => {
    await start(backend([]));

    expect(await screen.findByText("Qué se borra")).toBeOnTheScreen();
    expect(
      screen.getByText("Todas tus comidas, con sus fotos, audios y comentarios."),
    ).toBeOnTheScreen();
    expect(screen.getByText("No se puede deshacer ni recuperar.")).toBeOnTheScreen();
    expect(screen.queryByText(/suscripción premium/)).toBeNull();
    expect(await deleteButton()).toBeDisabled();

    await typeWord("elimina");
    expect(await deleteButton()).toBeDisabled();
    await fireEvent.press(await deleteButton());
    expect(deletes()).toHaveLength(0);

    // Sin importar mayúsculas ni espacios de más.
    await typeWord(" eliminar ");
    expect(await deleteButton()).toBeEnabled();
  });

  it("con premium, avisa que la suscripción termina en el momento", async () => {
    await start(backend([], me({ tier: "premium", since: "2026-10-14T19:00:00.000Z" })));

    expect(
      await screen.findByText(/Tu suscripción premium termina en el momento: no se te cobra más/),
    ).toBeOnTheScreen();
  });

  it("al confirmar, borra la cuenta, limpia el teléfono y vuelve al login con un mensaje", async () => {
    const router = await start(backend([deleted]));

    await typeWord("ELIMINAR");
    await fireEvent.press(await deleteButton());

    expect(await screen.findByRole("header", { name: "Eliminamos tu cuenta" })).toBeOnTheScreen();
    expect(screen.getByText(/Gracias por haber usado CalorIA/)).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/login");
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0].headers.Authorization).toBe(`Bearer ${NEW_TOKENS.accessToken}`);
    // Sin tokens, sin archivos temporales (aunque alguno falle) y sin avisos viejos.
    expect(mockTokenStorage.current()).toBeNull();
    expect(mockCache.deleted).toEqual(mockCache.entries);
    expect(Notifications.dismissAllNotificationsAsync).toHaveBeenCalled();
    // La cuenta ya no existe: no hay sesión que cerrar en el servidor.
    expect(calls.some((call) => call.path === "/auth/logout")).toBe(false);
  });

  it("si falla la conexión, la sesión queda como estaba y se puede reintentar", async () => {
    const router = await start(backend([offline, deleted]));

    await typeWord("ELIMINAR");
    await fireEvent.press(await deleteButton());

    expect(
      await screen.findByText(
        "No pudimos confirmar que se eliminó: revisá tu conexión y probá de nuevo.",
      ),
    ).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/profile/delete");
    expect(mockTokenStorage.current()).toEqual(NEW_TOKENS);
    expect(mockCache.deleted).toEqual([]);
    // La palabra sigue escrita: el mismo botón reintenta.
    expect(await deleteButton()).toBeEnabled();

    await fireEvent.press(await deleteButton());
    expect(await screen.findByRole("header", { name: "Eliminamos tu cuenta" })).toBeOnTheScreen();
    expect(deletes()).toHaveLength(2);
  });

  it("si el servicio no está disponible, no toca nada local", async () => {
    const router = await start(backend([() => apiError(503, "SERVICE_UNAVAILABLE")]));

    await typeWord("ELIMINAR");
    await fireEvent.press(await deleteButton());

    expect(
      await screen.findByText(
        "No pudimos eliminar tu cuenta ahora. Probá de nuevo en unos minutos.",
      ),
    ).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/profile/delete");
    expect(mockTokenStorage.current()).toEqual(NEW_TOKENS);
    expect(mockCache.deleted).toEqual([]);
    expect(Notifications.dismissAllNotificationsAsync).not.toHaveBeenCalled();
  });

  it("al volver a entrar con otra cuenta, el mensaje ya no está", async () => {
    await start((call) => {
      if (call.path === "/auth/login") {
        return json(200, { ...OLD_TOKENS, user: { id: "u2", email: "otra@example.com" } });
      }
      return backend([deleted])(call);
    });

    await typeWord("ELIMINAR");
    await fireEvent.press(await deleteButton());
    await screen.findByRole("header", { name: "Eliminamos tu cuenta" });

    await fireEvent.changeText(screen.getByLabelText("Email"), "otra@example.com");
    await fireEvent.changeText(screen.getByLabelText("Contraseña"), "secreto123");
    await fireEvent.press(screen.getByRole("button", { name: "Ingresar" }));
    await waitFor(() => expect(screen.queryByText("Eliminamos tu cuenta")).toBeNull());
  });
});

describe("Eliminar cuenta sin pagos (build de Google Play)", () => {
  billingSwitch("false");

  it("con premium no habla de la suscripción", async () => {
    await start(backend([], me({ tier: "premium", since: "2026-10-14T19:00:00.000Z" })));

    expect(await screen.findByText("Qué se borra")).toBeOnTheScreen();
    expectNoPaymentText();
  });
});

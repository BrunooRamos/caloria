import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { createHttpClient } from "@/services/http-client";
import type { HttpClient } from "@/services/http-client";
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

let calls: Call[];

function start(handler: Handler, initialUrl = "/login") {
  mockTokenStorage = memoryStorage(null);
  const fake = fakeFetch(handler);
  calls = fake.calls;
  mockApi = createHttpClient({ baseUrl: BASE_URL, storage: mockTokenStorage, fetch: fake.fetch });
  return renderRouter("./src/app", { initialUrl });
}

const loggedIn = () => json(200, { ...NEW_TOKENS, user: { id: "u1", email: "cami@example.com" } });
const email = () => screen.getByLabelText("Email");
const password = () => screen.getByLabelText("Contraseña");
const confirmPassword = () => screen.getByLabelText("Repetí la contraseña");

/** Completa el form; en el registro, también la repetición de la contraseña. */
async function fill(emailValue: string, passwordValue: string, confirmValue?: string) {
  await fireEvent.changeText(await screen.findByLabelText("Email"), emailValue);
  await fireEvent.changeText(password(), passwordValue);
  if (confirmValue !== undefined) await fireEvent.changeText(confirmPassword(), confirmValue);
}

describe("login", () => {
  it("al enviar vacío muestra un error debajo de cada campo y no llama a la API", async () => {
    await start(loggedIn);

    await fireEvent.press(await screen.findByText("Ingresar"));

    expect(screen.getByText("Ingresá tu email.")).toBeOnTheScreen();
    expect(screen.getByText("Ingresá tu contraseña.")).toBeOnTheScreen();
    expect(calls).toHaveLength(0);
  });

  it("los errores aparecen al salir del campo, no mientras se escribe", async () => {
    await start(loggedIn);

    await fireEvent.changeText(await screen.findByLabelText("Email"), "cami");
    expect(screen.queryByText("Revisá el email: no parece válido.")).not.toBeOnTheScreen();

    await fireEvent(email(), "blur");
    expect(screen.getByText("Revisá el email: no parece válido.")).toBeOnTheScreen();

    // Tipeando, el error que ya estaba se va apenas el valor queda bien...
    await fireEvent.changeText(email(), "cami@example.com");
    expect(screen.queryByText("Revisá el email: no parece válido.")).not.toBeOnTheScreen();

    // ...pero uno nuevo no aparece hasta salir del campo.
    await fireEvent.changeText(email(), "cami@");
    expect(screen.queryByText("Revisá el email: no parece válido.")).not.toBeOnTheScreen();
    await fireEvent(email(), "blur");
    expect(screen.getByText("Revisá el email: no parece válido.")).toBeOnTheScreen();
  });

  it("el botón queda en loading durante la request y no hay doble envío", async () => {
    const response = deferred<Response>();
    await start(() => response.promise);

    await fill("cami@example.com", "secreto123");
    await fireEvent.press(screen.getByText("Ingresar"));

    // Un segundo intento, por el botón y por el "ir" del teclado, mientras la primera sigue en vuelo.
    await fireEvent.press(screen.getByText("Ingresar"));
    await fireEvent(password(), "submitEditing");

    expect(screen.getByRole("button", { name: "Ingresar" })).toBeBusy();
    expect(calls.filter((call) => call.path === "/auth/login")).toHaveLength(1);

    await act(async () => response.resolve(loggedIn()));
    expect(await screen.findByText("Sesión iniciada")).toBeOnTheScreen();
  });

  it('el "ir" del teclado envía el formulario', async () => {
    await start(loggedIn);

    await fill("cami@example.com", "secreto123");
    await fireEvent(password(), "submitEditing");

    expect(await screen.findByText("Sesión iniciada")).toBeOnTheScreen();
    expect(calls[0].path).toBe("/auth/login");
  });

  it("muestra u oculta la contraseña", async () => {
    await start(loggedIn);
    await screen.findByLabelText("Email");

    expect(password()).toHaveProp("secureTextEntry", true);
    await fireEvent.press(screen.getByLabelText("Mostrar contraseña"));
    expect(password()).toHaveProp("secureTextEntry", false);
    await fireEvent.press(screen.getByLabelText("Ocultar contraseña"));
    expect(password()).toHaveProp("secureTextEntry", true);
  });

  it("el placeholder de la contraseña cambia según si se ve o no", async () => {
    await start(loggedIn);
    await screen.findByLabelText("Email");

    expect(password()).toHaveProp("placeholder", "••••••••");
    await fireEvent.press(screen.getByLabelText("Mostrar contraseña"));
    expect(password()).toHaveProp("placeholder", "micontraseña");
    await fireEvent.press(screen.getByLabelText("Ocultar contraseña"));
    expect(password()).toHaveProp("placeholder", "••••••••");
  });

  it("con RATE_LIMITED y Retry-After dice cuánto esperar, en la pantalla", async () => {
    await start(() => apiError(429, "RATE_LIMITED", "req-1", { "Retry-After": "30" }));

    await fill("cami@example.com", "secreto123");
    await fireEvent.press(screen.getByText("Ingresar"));

    const message = "Hiciste muchos intentos seguidos. Probá de nuevo en 30 segundos.";
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });

  it("sin conexión lo dice, y el error se va al volver a intentar", async () => {
    let online = false;
    await start(() => {
      if (!online) throw new TypeError("Network request failed");
      return loggedIn();
    });

    await fill("cami@example.com", "secreto123");
    await fireEvent.press(screen.getByText("Ingresar"));
    expect(
      await screen.findByText("No hay conexión. Revisá tu internet y probá de nuevo."),
    ).toBeOnTheScreen();

    online = true;
    await fireEvent.press(screen.getByText("Ingresar"));
    expect(await screen.findByText("Sesión iniciada")).toBeOnTheScreen();
  });
});

describe("registro", () => {
  it("valida, guarda email y contraseña sin llamar a la API y sigue al perfil", async () => {
    const router = await start(loggedIn, "/register");

    await fill("cami@example.com", "corta");
    await fireEvent(password(), "blur");
    expect(screen.getByText("Usá al menos 8 caracteres.")).toBeOnTheScreen();

    await fireEvent.changeText(password(), "secreto123");
    await fireEvent.changeText(confirmPassword(), "secreto123");
    await fireEvent.press(screen.getByText("Continuar"));

    expect(await screen.findByText("Contanos sobre vos")).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/onboarding");
    expect(calls).toHaveLength(0);
  });

  it("pide repetir la contraseña y que coincida antes de seguir", async () => {
    const router = await start(loggedIn, "/register");

    await fill("cami@example.com", "secreto123");
    await fireEvent.press(screen.getByText("Continuar"));
    expect(screen.getByText("Repetí la contraseña.")).toBeOnTheScreen();

    await fireEvent.changeText(confirmPassword(), "secreto124");
    await fireEvent(confirmPassword(), "blur");
    expect(screen.getByText("Las contraseñas no coinciden.")).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/register");

    // Corregir la primera para que coincida también saca el error de la repetición.
    await fireEvent.changeText(password(), "secreto124");
    expect(screen.queryByText("Las contraseñas no coinciden.")).not.toBeOnTheScreen();

    // El "ir" del teclado en la repetición envía el form.
    await fireEvent(confirmPassword(), "submitEditing");
    expect(await screen.findByText("Contanos sobre vos")).toBeOnTheScreen();
    expect(calls).toHaveLength(0);
  });
});

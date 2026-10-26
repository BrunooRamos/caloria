import type * as React from "react";
import type * as ReactNative from "react-native";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { HEALTH_DISCLAIMER } from "@/features/profile/HealthDisclaimer";
import type { Profile } from "@/services/auth";
import { createHttpClient } from "@/services/http-client";
import type { HttpClient } from "@/services/http-client";
import type { Me, Targets } from "@/services/users";
import type { AuthTokens } from "@/services/token-storage";
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

// La zona del dispositivo: distinta a cualquier valor por defecto, para ver que sale de acá.
jest.mock("expo-localization", () => ({
  getCalendars: () => [{ timeZone: "America/Argentina/Cordoba" }],
}));

// El selector nativo se reemplaza por una View que recibe los mismos props.
jest.mock("@react-native-community/datetimepicker", () => {
  const { createElement } = jest.requireActual<typeof React>("react");
  const { View } = jest.requireActual<typeof ReactNative>("react-native");
  return { __esModule: true, default: (props: object) => createElement(View, props) };
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

const PROFILE: Profile = {
  sex: "female",
  birthDate: "2002-04-10",
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: "America/Argentina/Cordoba",
};

const TARGETS: Targets = { kcal: 2093, proteinG: 108, carbsG: 285, fatG: 58 };

const me = (overrides: Partial<Me> = {}): Me => ({
  id: "u1",
  email: "cami@example.com",
  profile: PROFILE,
  targets: TARGETS,
  tone: "neutro",
  plan: { tier: "free", since: "2026-10-14T19:00:00.000Z" },
  ...overrides,
});

const registered = () =>
  json(201, { ...NEW_TOKENS, user: { id: "u1", email: "cami@example.com" } });

let calls: Call[];

function start(handler: Handler, initialUrl: string, tokens: AuthTokens | null = null) {
  mockTokenStorage = memoryStorage(tokens);
  const fake = fakeFetch(handler);
  calls = fake.calls;
  mockApi = createHttpClient({ baseUrl: BASE_URL, storage: mockTokenStorage, fetch: fake.fetch });
  return renderRouter("./src/app", { initialUrl });
}

/** Backend del registro: crea la cuenta y después responde `/users/me`. */
function signUpBackend(getMe: Handler = () => json(200, me())): Handler {
  return (call) => {
    if (call.path === "/auth/register") return registered();
    if (call.path === "/users/me" && call.method === "GET") return getMe(call);
    return apiError(404, "NOT_FOUND");
  };
}

const sentBody = (path: string, method = "POST") =>
  JSON.parse(String(calls.find((call) => call.path === path && call.method === method)?.body));

async function fillCredentials() {
  await fireEvent.changeText(await screen.findByLabelText("Email"), "cami@example.com");
  await fireEvent.changeText(screen.getByLabelText("Contraseña"), "secreto123");
  await fireEvent.changeText(screen.getByLabelText("Repetí la contraseña"), "secreto123");
  await fireEvent.press(screen.getByText("Continuar"));
  await screen.findByText("Contanos sobre vos");
}

/** En iOS la rueda se abre debajo del campo; se elige la fecha y se cierra con "Listo". */
async function pickBirthDate(year: number, month: number, day: number) {
  await fireEvent.press(screen.getByRole("button", { name: "Fecha de nacimiento" }));
  await fireEvent(
    screen.getByTestId("Fecha de nacimiento-picker"),
    "valueChange",
    { nativeEvent: {} },
    new Date(year, month - 1, day),
  );
  await fireEvent.press(screen.getByText("Listo"));
}

async function fillAboutYou() {
  await fireEvent.press(screen.getByRole("radio", { name: "Femenino" }));
  await pickBirthDate(2002, 4, 10);
  await fireEvent.press(screen.getByText("Continuar"));
  await screen.findByText("Altura y peso");
}

async function fillMeasures(height = "165", weight = "60") {
  await fireEvent.changeText(screen.getByLabelText("Altura (cm)"), height);
  await fireEvent.changeText(screen.getByLabelText("Peso (kg)"), weight);
  await fireEvent.press(screen.getByText("Continuar"));
  await screen.findByText("Tu día a día");
}

async function fillRoutine() {
  await fireEvent.press(screen.getByRole("radio", { name: "Moderada" }));
  await fireEvent.press(screen.getByRole("radio", { name: "Mantener mi peso" }));
}

describe("registro con perfil", () => {
  it("valida cada paso en la app antes de seguir y no llama a la API", async () => {
    await start(signUpBackend(), "/register");
    await fillCredentials();

    await fireEvent.press(screen.getByText("Continuar"));
    expect(screen.getByText("Elegí una opción.")).toBeOnTheScreen();
    expect(screen.getByText("Elegí tu fecha de nacimiento.")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("radio", { name: "Masculino" }));
    await pickBirthDate(2015, 1, 1);
    await fireEvent.press(screen.getByText("Continuar"));
    expect(screen.getByText("CalorIA es para personas de 16 a 100 años.")).toBeOnTheScreen();
    expect(screen.queryByText("Elegí una opción.")).not.toBeOnTheScreen();

    await pickBirthDate(2002, 4, 10);
    await fireEvent.press(screen.getByText("Continuar"));
    await screen.findByText("Altura y peso");

    await fireEvent.changeText(screen.getByLabelText("Altura (cm)"), "90");
    await fireEvent.changeText(screen.getByLabelText("Peso (kg)"), "sesenta");
    await fireEvent.press(screen.getByText("Continuar"));
    expect(screen.getByText("Tiene que estar entre 100 y 250 cm.")).toBeOnTheScreen();
    expect(screen.getByText("Ingresá tu peso en kg, solo con números.")).toBeOnTheScreen();

    await fillMeasures("180", "75,5");
    await fireEvent.press(screen.getByText("Crear cuenta"));
    expect(screen.getByText("Elegí tu nivel de actividad.")).toBeOnTheScreen();
    expect(screen.getByText("Elegí tu objetivo.")).toBeOnTheScreen();

    expect(calls).toHaveLength(0);
  });

  it("altura y peso usan teclado numérico", async () => {
    await start(signUpBackend(), "/register");
    await fillCredentials();
    await fillAboutYou();

    expect(screen.getByLabelText("Altura (cm)")).toHaveProp("keyboardType", "number-pad");
    expect(screen.getByLabelText("Peso (kg)")).toHaveProp("keyboardType", "decimal-pad");
  });

  it("se puede volver atrás sin perder lo cargado", async () => {
    await start(signUpBackend(), "/register");
    await fillCredentials();
    await fillAboutYou();
    await fillMeasures("165", "60,5");
    await fireEvent.press(screen.getByRole("radio", { name: "Ligera" }));

    await fireEvent.press(screen.getByText("Volver"));
    expect(await screen.findByLabelText("Peso (kg)")).toHaveProp("value", "60,5");
    expect(screen.getByLabelText("Altura (cm)")).toHaveProp("value", "165");
    await fireEvent.press(screen.getByText("Volver"));
    expect(await screen.findByRole("radio", { name: "Femenino" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Fecha de nacimiento" })).toHaveProp(
      "accessibilityValue",
      {
        text: "10 de abril de 2002",
      },
    );

    await fireEvent.press(screen.getByText("Continuar"));
    await fireEvent.press(await screen.findByText("Continuar"));
    expect(await screen.findByRole("radio", { name: "Ligera" })).toBeChecked();
  });

  it("manda todo en un solo POST con la zona horaria del dispositivo y muestra las metas de la API", async () => {
    const router = await start(signUpBackend(), "/register");
    await fillCredentials();
    await fillAboutYou();
    await fillMeasures("165", "60");
    await fillRoutine();
    await fireEvent.press(screen.getByText("Crear cuenta"));

    expect(await screen.findByText("Tus metas diarias")).toBeOnTheScreen();
    expect(calls.filter((call) => call.path === "/auth/register")).toHaveLength(1);
    expect(sentBody("/auth/register")).toEqual({
      email: "cami@example.com",
      password: "secreto123",
      profile: PROFILE,
    });

    // Las metas salen de GET /users/me, tal cual.
    expect(await screen.findByText("2093")).toBeOnTheScreen();
    expect(screen.getByLabelText("Proteína: 108 gramos")).toBeOnTheScreen();
    expect(screen.getByLabelText("Carbohidratos: 285 gramos")).toBeOnTheScreen();
    expect(screen.getByLabelText("Grasas: 58 gramos")).toBeOnTheScreen();
    expect(screen.getByText(HEALTH_DISCLAIMER)).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/goals");

    await fireEvent.press(screen.getByText("Empezar"));
    expect(await screen.findByText("Sesión iniciada")).toBeOnTheScreen();
    expect(mockTokenStorage.current()).toEqual(NEW_TOKENS);
  });

  it("el botón de crear cuenta queda en loading y no hay doble envío", async () => {
    const response = deferred<Response>();
    await start(
      (call) => (call.path === "/auth/register" ? response.promise : json(200, me())),
      "/register",
    );
    await fillCredentials();
    await fillAboutYou();
    await fillMeasures();
    await fillRoutine();

    await fireEvent.press(screen.getByText("Crear cuenta"));
    await fireEvent.press(screen.getByText("Crear cuenta"));
    expect(screen.getByRole("button", { name: "Crear cuenta" })).toBeBusy();
    expect(calls.filter((call) => call.path === "/auth/register")).toHaveLength(1);

    await act(async () => response.resolve(registered()));
    expect(await screen.findByText("Tus metas diarias")).toBeOnTheScreen();
  });

  it("si la API rechaza el perfil, lo dice en el último paso", async () => {
    await start(() => apiError(400, "VALIDATION_ERROR"), "/register");
    await fillCredentials();
    await fillAboutYou();
    await fillMeasures();
    await fillRoutine();
    await fireEvent.press(screen.getByText("Crear cuenta"));

    expect(
      await screen.findByText(
        "No pudimos crear tu cuenta: revisá los datos de los pasos anteriores.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText("Tu día a día")).toBeOnTheScreen();
  });

  it("si el email ya existe, vuelve al registro con el error en el campo email", async () => {
    const router = await start(() => apiError(409, "EMAIL_TAKEN"), "/register");
    await fillCredentials();
    await fillAboutYou();
    await fillMeasures();
    await fillRoutine();
    await fireEvent.press(screen.getByText("Crear cuenta"));

    expect(await screen.findByText("Ya hay una cuenta con este email.")).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/register");
    expect(screen.getByLabelText("Email")).toHaveProp(
      "accessibilityHint",
      "Ya hay una cuenta con este email.",
    );

    // Al editar el email, el error de la API se va.
    await fireEvent.changeText(screen.getByLabelText("Email"), "otra@example.com");
    expect(screen.queryByText("Ya hay una cuenta con este email.")).not.toBeOnTheScreen();
  });

  it("si no puede traer las metas, deja reintentar o seguir al inicio", async () => {
    let online = false;
    await start(
      signUpBackend(() => {
        if (!online) throw new TypeError("Network request failed");
        return json(200, me());
      }),
      "/register",
    );
    await fillCredentials();
    await fillAboutYou();
    await fillMeasures();
    await fillRoutine();
    await fireEvent.press(screen.getByText("Crear cuenta"));

    expect(
      await screen.findByText("No hay conexión. Revisá tu internet y probá de nuevo."),
    ).toBeOnTheScreen();
    expect(screen.getByText("Ir al inicio")).toBeOnTheScreen();

    online = true;
    await fireEvent.press(screen.getByText("Reintentar"));
    expect(await screen.findByText("2093")).toBeOnTheScreen();
  });
});

describe("perfil", () => {
  /** Sesión guardada: el refresh de arranque entra directo. */
  function profileBackend(patch: Handler = () => json(200, me())): Handler {
    return (call) => {
      if (call.path === "/auth/refresh") return json(200, { ...NEW_TOKENS });
      if (call.path === "/users/me" && call.method === "GET") return json(200, me());
      if (call.path === "/users/me" && call.method === "PATCH") return patch(call);
      return apiError(404, "NOT_FOUND");
    };
  }

  const patches = () =>
    calls.filter((call) => call.path === "/users/me" && call.method === "PATCH");

  it("muestra los datos cargados, las metas y el aviso, sin IMC ni etiquetas sobre el cuerpo", async () => {
    await start(profileBackend(), "/profile", NEW_TOKENS);

    expect(await screen.findByText("Tus datos")).toBeOnTheScreen();
    expect(screen.getByRole("radio", { name: "Femenino" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Fecha de nacimiento" })).toHaveProp(
      "accessibilityValue",
      {
        text: "10 de abril de 2002",
      },
    );
    expect(screen.getByLabelText("Altura (cm)")).toHaveProp("value", "165");
    expect(screen.getByLabelText("Peso (kg)")).toHaveProp("value", "60");
    expect(screen.getByRole("radio", { name: "Moderada" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Mantener mi peso" })).toBeChecked();
    expect(screen.getByText("2093")).toBeOnTheScreen();
    expect(screen.getByText(HEALTH_DISCLAIMER)).toBeOnTheScreen();

    for (const banned of [/IMC/i, /sobrepeso/i, /obesidad/i, /bajo peso/i]) {
      expect(screen.queryByText(banned)).not.toBeOnTheScreen();
    }

    // Sin cambios no hay nada que guardar.
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  });

  it("al guardar manda solo lo que cambió y muestra las metas nuevas sin salir de la pantalla", async () => {
    const response = deferred<Response>();
    await start(
      profileBackend(() => response.promise),
      "/profile",
      NEW_TOKENS,
    );

    await fireEvent.changeText(await screen.findByLabelText("Peso (kg)"), "58,5");
    await fireEvent.press(screen.getByRole("radio", { name: "Bajar de peso" }));
    await fireEvent.press(screen.getByText("Guardar cambios"));

    // Mientras guarda: loading, campos bloqueados y un solo PATCH aunque se toque de nuevo.
    await fireEvent.press(screen.getByText("Guardar cambios"));
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeBusy();
    expect(screen.getByLabelText("Peso (kg)")).toHaveProp("editable", false);
    expect(patches()).toHaveLength(1);
    expect(sentBody("/users/me", "PATCH")).toEqual({ profile: { weightKg: 58.5, goal: "lose" } });

    const targets: Targets = { kcal: 1555, proteinG: 105, carbsG: 191, fatG: 43 };
    await act(async () =>
      response.resolve(
        json(200, me({ profile: { ...PROFILE, weightKg: 58.5, goal: "lose" }, targets })),
      ),
    );

    expect(await screen.findByText("1555")).toBeOnTheScreen();
    expect(screen.queryByText("2093")).not.toBeOnTheScreen();
    expect(screen.getByLabelText("Proteína: 105 gramos")).toBeOnTheScreen();
    expect(
      screen.getByText("Guardamos tus cambios y tus metas ya están actualizadas."),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    expect(calls.filter((call) => call.method === "GET" && call.path === "/users/me")).toHaveLength(
      1,
    );
  });

  it("valida en el campo antes de mandar", async () => {
    await start(profileBackend(), "/profile", NEW_TOKENS);

    await fireEvent.changeText(await screen.findByLabelText("Altura (cm)"), "260");
    await fireEvent.press(screen.getByText("Guardar cambios"));

    expect(screen.getByText("Tiene que estar entre 100 y 250 cm.")).toBeOnTheScreen();
    expect(patches()).toHaveLength(0);
  });

  it("si la API devuelve un error, lo muestra con un mensaje entendible", async () => {
    await start(
      profileBackend(() => apiError(400, "VALIDATION_ERROR")),
      "/profile",
      NEW_TOKENS,
    );

    await fireEvent.changeText(await screen.findByLabelText("Peso (kg)"), "61");
    await fireEvent.press(screen.getByText("Guardar cambios"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Revisá los datos e intentá de nuevo.",
    );
    expect(screen.getByText("2093")).toBeOnTheScreen();
  });
});

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
import { spyAlerts } from "@/test-utils/alert";
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
  notifications: { analysisReady: true, streakRisk: true, wrappedReady: true },
  ...overrides,
});

const FREE_PLAN = {
  tier: "free",
  periodEnd: null,
  renews: false,
  analyses: { limit: 40, remaining: 37, resetsOn: "2026-12-01" },
};

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
    expect(screen.getByLabelText("Proteínas: 108 gramos")).toBeOnTheScreen();
    expect(screen.getByLabelText("Carbohidratos: 285 gramos")).toBeOnTheScreen();
    expect(screen.getByLabelText("Grasas: 58 gramos")).toBeOnTheScreen();
    expect(screen.getByText(HEALTH_DISCLAIMER)).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/goals");

    await fireEvent.press(screen.getByText("Empezar"));
    expect(await screen.findByText("Hoy")).toBeOnTheScreen();
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
      if (call.path === "/billing/plan") return json(200, FREE_PLAN);
      return apiError(404, "NOT_FOUND");
    };
  }

  /** Como el servidor: lo que se guarda es lo que devuelve el próximo GET. */
  function statefulBackend(): Handler {
    let current = me();
    return (call) => {
      if (call.path === "/auth/refresh") return json(200, { ...NEW_TOKENS });
      if (call.path === "/users/me" && call.method === "GET") return json(200, current);
      if (call.path === "/users/me" && call.method === "PATCH") {
        const body = JSON.parse(String(call.body)) as Partial<Me>;
        current = {
          ...current,
          ...body,
          notifications: { ...current.notifications, ...body.notifications },
        };
        return json(200, current);
      }
      return apiError(404, "NOT_FOUND");
    };
  }

  const patches = () =>
    calls.filter((call) => call.path === "/users/me" && call.method === "PATCH");
  const press = async (name: string | RegExp) =>
    fireEvent.press(await screen.findByRole("button", { name }));

  describe("la pantalla principal del perfil", () => {
    it("es un menú: cada sección con el resumen de lo que tiene, y cerrar sesión al final", async () => {
      await start(profileBackend(), "/profile", NEW_TOKENS);

      expect(await screen.findByText("cami@example.com")).toBeOnTheScreen();
      for (const name of [
        "Tu plan, Free · te quedan 37 análisis",
        "Tus metas diarias, 2.093 kcal por día",
        "Tus datos, 60 kg · Mantener mi peso",
        "Comentario de tus comidas, Neutro",
        "Avisos, Todos activados",
      ]) {
        expect(screen.getByRole("button", { name })).toBeOnTheScreen();
      }
      expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeOnTheScreen();
      // Nada del formulario en esta pantalla: queda corta.
      expect(screen.queryByLabelText("Peso (kg)")).toBeNull();
      expect(screen.queryByRole("radio")).toBeNull();
    });

    it("cada fila abre su sección y Volver regresa al perfil", async () => {
      const router = await start(profileBackend(), "/profile", NEW_TOKENS);
      for (const [row, path, header] of [
        [/^Tu plan/, "/plan", "Tu plan"],
        [/^Tus metas diarias/, "/profile/targets", "Tus metas diarias"],
        [/^Tus datos/, "/profile/data", "Tus datos"],
        [/^Comentario de tus comidas/, "/profile/tone", "Comentario de tus comidas"],
        [/^Avisos/, "/profile/notifications", "Avisos"],
      ] as const) {
        await press(row);
        expect(router.getPathname()).toBe(path);
        expect(await screen.findByRole("header", { name: header })).toBeOnTheScreen();
        await press("Volver");
        expect(router.getPathname()).toBe("/profile");
      }
    });

    it("al volver de una sección, el resumen muestra lo que se cambió", async () => {
      await start(statefulBackend(), "/profile", NEW_TOKENS);
      await press(/^Comentario de tus comidas/);
      await fireEvent.press(await screen.findByRole("radio", { name: "Roast" }));
      expect(await screen.findByText(/^Guardamos tu elección/)).toBeOnTheScreen();

      await press("Volver");
      expect(
        await screen.findByRole("button", { name: "Comentario de tus comidas, Roast" }),
      ).toBeOnTheScreen();
    });

    it("si no carga, lo dice y las secciones siguen a mano", async () => {
      const router = await start(
        (call) =>
          call.path === "/users/me" ? apiError(503, "SERVICE_UNAVAILABLE") : profileBackend()(call),
        "/profile",
        NEW_TOKENS,
      );
      expect(
        await screen.findByText(
          "El servicio no está disponible ahora. Probá de nuevo en unos minutos.",
        ),
      ).toBeOnTheScreen();
      expect(screen.getByRole("button", { name: "Reintentar" })).toBeOnTheScreen();
      await press("Tus datos");
      expect(router.getPathname()).toBe("/profile/data");
    });
  });

  describe("tus metas diarias", () => {
    it("las metas y el aviso, sin IMC ni etiquetas sobre el cuerpo, y un atajo a tus datos", async () => {
      const router = await start(profileBackend(), "/profile/targets", NEW_TOKENS);

      expect(await screen.findByText("2093")).toBeOnTheScreen();
      expect(screen.getByLabelText("Proteínas: 108 gramos")).toBeOnTheScreen();
      expect(screen.getByText(HEALTH_DISCLAIMER)).toBeOnTheScreen();
      for (const banned of [/IMC/i, /sobrepeso/i, /obesidad/i, /bajo peso/i]) {
        expect(screen.queryByText(banned)).not.toBeOnTheScreen();
      }

      await press("Cambiar tus datos");
      expect(router.getPathname()).toBe("/profile/data");
    });
  });

  describe("tus datos", () => {
    it("muestra los datos cargados; sin cambios no hay nada que guardar", async () => {
      await start(profileBackend(), "/profile/data", NEW_TOKENS);

      expect(await screen.findByRole("radio", { name: "Femenino" })).toBeChecked();
      expect(screen.getByRole("button", { name: "Fecha de nacimiento" })).toHaveProp(
        "accessibilityValue",
        { text: "10 de abril de 2002" },
      );
      expect(screen.getByLabelText("Altura (cm)")).toHaveProp("value", "165");
      expect(screen.getByLabelText("Peso (kg)")).toHaveProp("value", "60");
      expect(screen.getByRole("radio", { name: "Moderada" })).toBeChecked();
      expect(screen.getByRole("radio", { name: "Mantener mi peso" })).toBeChecked();
      for (const banned of [/IMC/i, /sobrepeso/i, /obesidad/i, /bajo peso/i]) {
        expect(screen.queryByText(banned)).not.toBeOnTheScreen();
      }
      expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    });

    it("al guardar manda solo lo que cambió y avisa la meta nueva", async () => {
      const response = deferred<Response>();
      await start(
        profileBackend(() => response.promise),
        "/profile/data",
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
      expect(sentBody("/users/me", "PATCH")).toEqual({
        profile: { weightKg: 58.5, goal: "lose" },
      });

      const targets: Targets = { kcal: 1555, proteinG: 105, carbsG: 191, fatG: 43 };
      await act(async () =>
        response.resolve(
          json(200, me({ profile: { ...PROFILE, weightKg: 58.5, goal: "lose" }, targets })),
        ),
      );

      expect(
        await screen.findByText("Guardamos tus datos. Tu meta ahora es de 1.555 kcal por día."),
      ).toBeOnTheScreen();
      expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
      expect(
        calls.filter((call) => call.method === "GET" && call.path === "/users/me"),
      ).toHaveLength(1);
    });

    it("valida en el campo antes de mandar", async () => {
      await start(profileBackend(), "/profile/data", NEW_TOKENS);

      await fireEvent.changeText(await screen.findByLabelText("Altura (cm)"), "260");
      await fireEvent.press(screen.getByText("Guardar cambios"));

      expect(screen.getByText("Tiene que estar entre 100 y 250 cm.")).toBeOnTheScreen();
      expect(patches()).toHaveLength(0);
    });

    it("si la API devuelve un error, lo muestra con un mensaje entendible", async () => {
      await start(
        profileBackend(() => apiError(400, "VALIDATION_ERROR")),
        "/profile/data",
        NEW_TOKENS,
      );

      await fireEvent.changeText(await screen.findByLabelText("Peso (kg)"), "61");
      await fireEvent.press(screen.getByText("Guardar cambios"));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Revisá los datos e intentá de nuevo.",
      );
      expect(screen.getByLabelText("Peso (kg)")).toHaveProp("value", "61");
    });

    it("con cambios sin guardar, Volver pregunta antes de descartarlos", async () => {
      const router = await start(profileBackend(), "/profile", NEW_TOKENS);
      await press(/^Tus datos/);
      await fireEvent.changeText(await screen.findByLabelText("Peso (kg)"), "58");
      const alerts = spyAlerts();

      await press("Volver");
      expect(alerts.last().title).toBe("¿Descartar los cambios?");
      expect(alerts.last().buttons.map((button) => button.text)).toEqual([
        "Seguir editando",
        "Descartar",
      ]);
      await alerts.press("Seguir editando");
      expect(router.getPathname()).toBe("/profile/data");
      expect(screen.getByLabelText("Peso (kg)")).toHaveProp("value", "58");

      await press("Volver");
      await alerts.press("Descartar");
      expect(router.getPathname()).toBe("/profile");
      expect(patches()).toHaveLength(0);
    });
  });

  describe("tono del comentario", () => {
    const toneRadio = (name: string) => screen.getByRole("radio", { name });

    it("viene marcado el tono guardado y cada opción explica qué hace", async () => {
      await start(profileBackend(), "/profile/tone", NEW_TOKENS);

      expect(
        await screen.findByRole("header", { name: "Comentario de tus comidas" }),
      ).toBeOnTheScreen();
      expect(screen.getByLabelText("Tono del comentario")).toHaveProp(
        "accessibilityRole",
        "radiogroup",
      );
      expect(toneRadio("Neutro")).toBeChecked();
      for (const name of ["Motivador", "Roast", "Sin comentario"]) {
        expect(toneRadio(name)).not.toBeChecked();
      }
      expect(toneRadio("Roast")).toHaveProp(
        "accessibilityHint",
        "Humor ácido sobre la comida, nunca sobre vos.",
      );
      expect(toneRadio("Sin comentario")).toHaveProp(
        "accessibilityHint",
        "No vas a ver comentarios en tus análisis.",
      );
    });

    it("al elegir, lo guarda solo, bloquea el grupo mientras tanto y queda marcado", async () => {
      const response = deferred<Response>();
      await start(
        profileBackend(() => response.promise),
        "/profile/tone",
        NEW_TOKENS,
      );

      await fireEvent.press(await screen.findByRole("radio", { name: "Roast" }));

      expect(toneRadio("Roast")).toBeChecked();
      expect(toneRadio("Roast")).toBeDisabled();
      expect(toneRadio("Neutro")).toBeDisabled();
      expect(screen.getByText("Guardando tu elección…")).toBeOnTheScreen();
      await fireEvent.press(toneRadio("Motivador"));
      expect(patches()).toHaveLength(1);
      expect(sentBody("/users/me", "PATCH")).toEqual({ tone: "roast" });

      await act(async () => response.resolve(json(200, me({ tone: "roast" }))));

      expect(
        await screen.findByText("Guardamos tu elección. Se usa desde tu próximo análisis."),
      ).toBeOnTheScreen();
      expect(toneRadio("Roast")).toBeChecked();
      expect(toneRadio("Roast")).toBeEnabled();
      expect(screen.queryByText("Guardando tu elección…")).not.toBeOnTheScreen();
    });

    it("elegir el tono que ya está no manda nada", async () => {
      await start(profileBackend(), "/profile/tone", NEW_TOKENS);

      await fireEvent.press(await screen.findByRole("radio", { name: "Neutro" }));
      expect(patches()).toHaveLength(0);
    });

    it("si el PATCH falla, vuelve al tono anterior y muestra el error", async () => {
      await start(
        profileBackend(() => {
          throw new TypeError("Network request failed");
        }),
        "/profile/tone",
        NEW_TOKENS,
      );

      await fireEvent.press(await screen.findByRole("radio", { name: "Sin comentario" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "No hay conexión. Revisá tu internet y probá de nuevo.",
      );
      expect(toneRadio("Neutro")).toBeChecked();
      expect(toneRadio("Sin comentario")).not.toBeChecked();
      expect(toneRadio("Sin comentario")).toBeEnabled();
      expect(
        screen.queryByText("Guardamos tu elección. Se usa desde tu próximo análisis."),
      ).not.toBeOnTheScreen();
    });
  });
});

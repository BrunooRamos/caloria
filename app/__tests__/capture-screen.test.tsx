import * as ImagePicker from "expo-image-picker";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import type * as React from "react";
import type * as ReactNative from "react-native";
import { Linking } from "react-native";
import { PHOTO_MAX_BYTES } from "@/features/meals/prepare-photo";
import { TOO_LARGE_MESSAGE } from "@/features/meals/PreviewStep";
import { createHttpClient } from "@/services/http-client";
import type { HttpClient } from "@/services/http-client";
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
import type { Call, Handler } from "@/test-utils/fake-api";

jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hide: jest.fn(),
}));

// Rutas, store y cliente HTTP reales; se reemplazan SecureStore, la red y los módulos nativos.
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

interface MockPermission {
  granted: boolean;
  status: "granted" | "denied" | "undetermined";
  canAskAgain: boolean;
}

// Cámara falsa: avisa que está lista al montarse y "saca" siempre la misma foto.
const mockCamera = {
  permission: { granted: true, status: "granted", canAskAgain: true } as MockPermission,
  requestPermission: jest.fn(),
  getPermission: jest.fn(),
  takePicture: jest.fn(),
};
jest.mock("expo-camera", () => {
  const { createElement, useEffect, useImperativeHandle } =
    jest.requireActual<typeof React>("react");
  const { View } = jest.requireActual<typeof ReactNative>("react-native");
  function CameraView({
    ref,
    onCameraReady,
  }: {
    ref?: React.Ref<unknown>;
    onCameraReady?: () => void;
  }) {
    useImperativeHandle(ref, () => ({ takePictureAsync: mockCamera.takePicture }));
    useEffect(() => onCameraReady?.(), [onCameraReady]);
    return createElement(View, { testID: "camera-preview" });
  }
  return {
    CameraView,
    useCameraPermissions: () => [
      mockCamera.permission,
      mockCamera.requestPermission,
      mockCamera.getPermission,
    ],
  };
});

jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn() }));

// Manipulador falso: devuelve la foto comprimida en `mockPhoto` y su peso en `mockPhoto.bytes`.
const mockPhoto = { uri: "file:///cache/comprimida.jpg", width: 1600, height: 1200, bytes: 0 };
jest.mock("expo-image-manipulator", () => {
  const image = {
    width: 4032,
    height: 3024,
    saveAsync: async () => ({
      uri: mockPhoto.uri,
      width: mockPhoto.width,
      height: mockPhoto.height,
    }),
  };
  const context = { resize: () => context, renderAsync: async () => image };
  return { SaveFormat: { JPEG: "jpeg" }, ImageManipulator: { manipulate: () => context } };
});
jest.mock("expo-file-system", () => ({
  File: class {
    get size() {
      return mockPhoto.bytes;
    }
  },
}));

const MEAL_ID = "66f1a0000000000000000099";
const accepted = () => json(202, { mealId: MEAL_ID, status: "processing" });

let calls: Call[];
const mealPosts = () => calls.filter((call) => call.path === "/meals" && call.method === "POST");

function start(meals: Handler = accepted) {
  mockTokenStorage = memoryStorage(OLD_TOKENS);
  const fake = fakeFetch((call) => {
    if (call.path === "/auth/refresh") return json(200, { ...NEW_TOKENS });
    if (call.path === "/meals" && call.method === "POST") return meals(call);
    return apiError(404, "NOT_FOUND");
  });
  calls = fake.calls;
  mockApi = createHttpClient({ baseUrl: BASE_URL, storage: mockTokenStorage, fetch: fake.fetch });
  return renderRouter("./src/app", { initialUrl: "/" });
}

/** Pantallas apiladas en el grupo con sesión. */
const appRoutes = (router: Awaited<ReturnType<typeof start>>) =>
  router.getRouterState()?.routes[0]?.state?.routes[0]?.state?.routes.map((route) => route.name);

const press = async (name: string) => fireEvent.press(await screen.findByRole("button", { name }));

/** Desde la home: botón flotante y disparador (interacciones 1 y 2). */
async function takePhoto() {
  await press("Registrar comida");
  await press("Sacar foto");
  await screen.findByText("¿Analizamos esta foto?");
}

beforeEach(() => {
  mockCamera.permission = { granted: true, status: "granted", canAskAgain: true };
  mockCamera.requestPermission.mockReset();
  mockCamera.takePicture.mockReset().mockResolvedValue({
    uri: "file:///camera/original.jpg",
    width: 4032,
    height: 3024,
    format: "jpg",
  });
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockReset();
  mockPhoto.bytes = 900_000;
});

describe("registrar una comida", () => {
  it("en 3 interacciones desde la home: sube la foto y reemplaza la captura por el resultado", async () => {
    const router = await start();
    await takePhoto();
    expect(screen.getByLabelText("Foto de tu comida")).toHaveProp("source", {
      uri: mockPhoto.uri,
    });

    await press("Enviar"); // 3

    expect(await screen.findByText("Analizando tu comida…")).toBeOnTheScreen();
    expect(router.getPathname()).toBe(`/meals/${MEAL_ID}`);
    expect(mealPosts()).toHaveLength(1);
    expect(mealPosts()[0].body).toBeInstanceOf(FormData);
    expect(mealPosts()[0].headers["Content-Type"]).toBeUndefined();
    // La captura ya no está en el stack: volver desde el resultado lleva a la home.
    expect(appRoutes(router)).toEqual(["index", "meals/[id]"]);
  });

  it("si falla la subida la foto queda y se reintenta sin sacarla de nuevo", async () => {
    let available = false;
    await start(() => (available ? accepted() : apiError(503, "SERVICE_UNAVAILABLE")));
    await takePhoto();

    await press("Enviar");
    expect(
      await screen.findByText(
        "El servicio no está disponible ahora. Probá de nuevo en unos minutos.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText("Foto de tu comida")).toBeOnTheScreen();

    available = true;
    await press("Reintentar");
    expect(await screen.findByText("Analizando tu comida…")).toBeOnTheScreen();
    expect(mealPosts()).toHaveLength(2);
    expect(mockCamera.takePicture).toHaveBeenCalledTimes(1);
  });

  it("no permite doble envío mientras sube", async () => {
    const response = deferred<Response>();
    await start(() => response.promise);
    await takePhoto();

    // fireEvent.press espera al handler, así que el primer envío queda en vuelo sin await. Antes del
    // segundo toque se deja terminar su act con microtasks (los timers son falsos), sin abrir otro.
    const firstPress = fireEvent.press(screen.getByRole("button", { name: "Enviar" }));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(screen.getByText("Subiendo foto…")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Enviar" }));
    expect(mealPosts()).toHaveLength(1);

    await act(async () => {
      response.resolve(accepted());
      await firstPress;
    });
    expect(await screen.findByText("Analizando tu comida…")).toBeOnTheScreen();
    expect(mealPosts()).toHaveLength(1);
  });

  it("sin cupo muestra un mensaje tranquilo y no navega", async () => {
    const router = await start(() => apiError(402, "MEAL_QUOTA_EXCEEDED"));
    await takePhoto();

    await press("Enviar");
    expect(
      await screen.findByText(
        "Llegaste al límite de análisis de este mes. Se renueva el 1.° del mes que viene.",
      ),
    ).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/capture");
  });

  it("si comprimida sigue pasando de 8 MB, muestra el error y no la sube", async () => {
    mockPhoto.bytes = PHOTO_MAX_BYTES + 1;
    await start();
    await takePhoto();

    expect(screen.getByText(TOO_LARGE_MESSAGE)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: "Enviar" }));
    expect(mealPosts()).toHaveLength(0);
  });

  it("Sacar otra vuelve a la cámara sin navegar", async () => {
    const router = await start();
    await takePhoto();

    await press("Sacar otra");
    expect(await screen.findByRole("button", { name: "Sacar foto" })).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/capture");
  });
});

describe("galería", () => {
  it("desde la vista de cámara: botón de galería, elegir la foto y Enviar", async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///galeria/plato.heic", width: 3024, height: 4032 }],
    } as ImagePicker.ImagePickerResult);
    const router = await start();

    await press("Registrar comida");
    await press("Elegir de la galería");
    expect(await screen.findByText("¿Analizamos esta foto?")).toBeOnTheScreen();
    await press("Enviar");

    expect(await screen.findByText("Analizando tu comida…")).toBeOnTheScreen();
    expect(router.getPathname()).toBe(`/meals/${MEAL_ID}`);
  });

  it("si se cancela el selector, sigue en la cámara", async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: true,
      assets: null,
    });
    await start();

    await press("Registrar comida");
    await press("Elegir de la galería");
    expect(await screen.findByRole("button", { name: "Sacar foto" })).toBeOnTheScreen();
    expect(screen.queryByText("¿Analizamos esta foto?")).toBeNull();
  });
});

describe("permiso de cámara", () => {
  it("sin decidir, se pide recién al abrir la cámara", async () => {
    mockCamera.permission = { granted: false, status: "undetermined", canAskAgain: true };
    await start();
    await screen.findByRole("button", { name: "Registrar comida" });
    expect(mockCamera.requestPermission).not.toHaveBeenCalled();

    await press("Registrar comida");
    await screen.findByRole("button", { name: "Sacar foto" });
    expect(mockCamera.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("negado y sin volver a preguntar: explica para qué es y lleva a la configuración", async () => {
    mockCamera.permission = { granted: false, status: "denied", canAskAgain: false };
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue();
    await start();

    await press("Registrar comida");
    expect(await screen.findByText("Necesitamos tu cámara")).toBeOnTheScreen();
    await press("Abrir configuración");
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("negado: no queda trabada, puede elegir de la galería o volver", async () => {
    mockCamera.permission = { granted: false, status: "denied", canAskAgain: true };
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///galeria/plato.jpg", width: 1200, height: 900 }],
    } as ImagePicker.ImagePickerResult);
    const router = await start();

    await press("Registrar comida");
    await press("Permitir cámara");
    expect(mockCamera.requestPermission).toHaveBeenCalledTimes(1);

    await press("Elegir de la galería");
    expect(await screen.findByText("¿Analizamos esta foto?")).toBeOnTheScreen();

    await press("Sacar otra");
    await press("Volver");
    expect(await screen.findByRole("button", { name: "Registrar comida" })).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/");
  });
});

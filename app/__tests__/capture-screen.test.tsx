import * as ImagePicker from "expo-image-picker";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import type * as React from "react";
import type * as ReactNative from "react-native";
import { AccessibilityInfo, AppState, Linking } from "react-native";
import type { AppStateStatus } from "react-native";
import { LIMIT_MESSAGE } from "@/features/meals/AudioNoteRecorder";
import { PHOTO_MAX_BYTES } from "@/features/meals/prepare-photo";
import { TOO_LARGE_MESSAGE } from "@/features/meals/PreviewStep";
import { AUDIO_MAX_SECONDS, TOO_SHORT_ERROR } from "@/features/meals/useAudioNote";
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
import { spyAlerts } from "@/test-utils/alert";
import { mockHardwareBack } from "@/test-utils/hardware-back";
import type { Call, Handler } from "@/test-utils/fake-api";
import { billingSwitch, expectNoPaymentText } from "@/test-utils/billing";

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
// `File` registra qué archivos se leyeron para el multipart.
const mockFiles: string[] = [];
jest.mock("expo-file-system", () => ({
  File: class {
    constructor(uri: string) {
      mockFiles.push(uri);
    }
    get size() {
      return mockPhoto.bytes;
    }
  },
}));

// Grabador falso: mide el largo con el reloj (falso) de Jest y deja en `uri` un archivo por toma.
// `finishNatively` simula el corte de `forDuration` del lado nativo.
const mockAudio = {
  permission: { granted: true, status: "granted", canAskAgain: true } as MockPermission,
  takes: 0,
  recorder: {
    uri: null as string | null,
    isRecording: false,
    startedAt: 0,
    listener: undefined as
      ((status: { isFinished: boolean; hasError: boolean }) => void) | undefined,
    prepareToRecordAsync: jest.fn(),
    record: jest.fn(),
    stop: jest.fn(),
    getStatus() {
      const { isRecording, startedAt } = mockAudio.recorder;
      return { isRecording, durationMillis: isRecording ? Date.now() - startedAt : 0 };
    },
    finishNatively() {
      mockAudio.recorder.isRecording = false;
      mockAudio.recorder.listener?.({ isFinished: true, hasError: false });
    },
  },
  player: {
    source: null as { uri: string } | null,
    playing: false,
    notify: () => {},
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(),
  },
  setAudioModeAsync: jest.fn(),
};
jest.mock("expo-audio", () => {
  const { useEffect, useReducer } = jest.requireActual<typeof React>("react");
  const useTick = (interval?: number) => {
    const [, tick] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
      if (!interval) return;
      const id = setInterval(tick, interval);
      return () => clearInterval(id);
    }, [interval]);
    return tick;
  };
  return {
    AudioQuality: { HIGH: 96 },
    IOSOutputFormat: { MPEG4AAC: "aac " },
    requestRecordingPermissionsAsync: async () => mockAudio.permission,
    setAudioModeAsync: (mode: object) => mockAudio.setAudioModeAsync(mode),
    useAudioRecorder: (_options: unknown, listener: typeof mockAudio.recorder.listener) => {
      mockAudio.recorder.listener = listener;
      return mockAudio.recorder;
    },
    useAudioRecorderState: (recorder: typeof mockAudio.recorder, interval: number) => {
      useTick(interval);
      return recorder.getStatus();
    },
    useAudioPlayer: (source: { uri: string } | null) => {
      mockAudio.player.source = source;
      return mockAudio.player;
    },
    useAudioPlayerStatus: () => {
      mockAudio.player.notify = useTick();
      return {
        playing: mockAudio.player.playing,
        isLoaded: mockAudio.player.source !== null,
        duration: 12,
        currentTime: 0,
        didJustFinish: false,
      };
    },
  };
});

const MEAL_ID = "66f1a0000000000000000099";
const accepted = () => json(202, { mealId: MEAL_ID, status: "processing" });
const analyzing = {
  id: MEAL_ID,
  status: "processing",
  capturedAt: "2026-10-26T13:05:00.000Z",
  photoUrl: "https://media.test/photo.jpg",
};

let calls: Call[];
const mealPosts = () => calls.filter((call) => call.path === "/meals" && call.method === "POST");

/**
 * `GET /billing/plan`. Por defecto 404: la barra abre la cámara sin preguntar y, sin cupo, la vista
 * previa cae en el 1.º del mes que viene.
 */
function start(meals: Handler = accepted, plan: Handler = () => apiError(404, "NOT_FOUND")) {
  mockTokenStorage = memoryStorage(OLD_TOKENS);
  const fake = fakeFetch((call) => {
    if (call.path === "/auth/refresh") return json(200, { ...NEW_TOKENS });
    if (call.path === "/meals" && call.method === "POST") return meals(call);
    // El resultado consulta el análisis: sigue en processing.
    if (call.path === `/meals/${MEAL_ID}`) return json(200, analyzing);
    if (call.path === "/billing/plan") return plan(call);
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

/** Desde la home: "Registrar comida" y el disparador (interacciones 1 y 2). */
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
  mockFiles.length = 0;

  mockAudio.permission = { granted: true, status: "granted", canAskAgain: true };
  mockAudio.takes = 0;
  const { recorder, player } = mockAudio;
  Object.assign(recorder, { uri: null, isRecording: false, startedAt: 0 });
  recorder.prepareToRecordAsync.mockReset().mockResolvedValue(undefined);
  recorder.record.mockReset().mockImplementation(() => {
    recorder.isRecording = true;
    recorder.startedAt = Date.now();
    recorder.uri = `file:///cache/ExpoAudio/toma-${++mockAudio.takes}.m4a`;
  });
  recorder.stop.mockReset().mockImplementation(async () => {
    recorder.isRecording = false;
  });
  player.playing = false;
  player.play.mockReset().mockImplementation(() => {
    player.playing = true;
    player.notify();
  });
  player.pause.mockReset().mockImplementation(() => {
    player.playing = false;
    player.notify();
  });
  player.seekTo.mockReset().mockResolvedValue(undefined);
  mockAudio.setAudioModeAsync.mockReset().mockResolvedValue(undefined);
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
    // La captura ya no está en el stack: volver desde el resultado lleva a las pestañas.
    expect(appRoutes(router)).toEqual(["(tabs)", "meals/[id]"]);
  });

  it("también desde la barra de pestañas, desde cualquier sección", async () => {
    const router = await start();
    await fireEvent.press(await screen.findByRole("tab", { name: "Historial" }));
    expect(router.getPathname()).toBe("/history");

    await press("Registrar");
    await press("Sacar foto");
    await press("Enviar");

    expect(await screen.findByText("Analizando tu comida…")).toBeOnTheScreen();
    expect(router.getPathname()).toBe(`/meals/${MEAL_ID}`);
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

  it("sin cupo lo dice con calma, sin rojo, y lleva a Tu plan", async () => {
    const router = await start(() => apiError(402, "MEAL_QUOTA_EXCEEDED"));
    await takePhoto();

    await press("Enviar");
    expect(await screen.findByText("Usaste los análisis de este mes")).toBeOnTheScreen();
    expect(
      screen.getByText(
        /^Se renuevan el 1\.º de \S+( de \d{4})?\. En Tu plan ves cuántos tenés y qué incluye cada plan\.$/,
      ),
    ).toBeOnTheScreen();
    // No es un error: sin el recuadro rojo de alerta ni "Reintentar".
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
    expect(router.getPathname()).toBe("/capture");

    await press("Ver planes");
    expect(router.getPathname()).toBe("/plan");
    // Volver deja la foto donde estaba, por si después quiere mandarla.
    await press("Volver");
    expect(await screen.findByText("¿Analizamos esta foto?")).toBeOnTheScreen();
  });

  it("sin cupo, la fecha de renovación es la del plan, la misma que en la hoja de Registrar", async () => {
    // Le quedan análisis para la barra (abre la cámara); el POST igual se rechaza por cupo.
    const plan = {
      tier: "free",
      periodEnd: null,
      renews: false,
      analyses: { limit: 40, remaining: 1, resetsOn: "2099-03-15" },
    };
    await start(
      () => apiError(402, "MEAL_QUOTA_EXCEEDED"),
      () => json(200, plan),
    );
    await takePhoto();

    await press("Enviar");
    expect(
      await screen.findByText(
        "Se renuevan el 15 de marzo de 2099. En Tu plan ves cuántos tenés y qué incluye cada plan.",
      ),
    ).toBeOnTheScreen();
  });

  it("con el tope diario alcanzado dice cuánto falta para volver a intentar", async () => {
    await start(() => apiError(429, "DAILY_LIMIT_EXCEEDED", "req-1", { "Retry-After": "32400" }));
    await takePhoto();

    await press("Enviar");
    expect(
      await screen.findByText(
        "Llegaste al máximo de fotos que se pueden analizar por día. Probá de nuevo en 9 horas.",
      ),
    ).toBeOnTheScreen();
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

describe("cerrar la captura", () => {
  it("Cerrar sale de la cámara y de la vista previa a la pantalla principal", async () => {
    const router = await start();
    await press("Registrar comida");
    await press("Cerrar");
    expect(await screen.findByRole("button", { name: "Registrar comida" })).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/");

    await takePhoto();
    await press("Cerrar");
    expect(await screen.findByRole("button", { name: "Registrar comida" })).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/");
  });

  it("el atrás de Android también vuelve al inicio, salvo mientras sube la foto", async () => {
    const { pressBack, spy } = mockHardwareBack();
    const response = deferred<Response>();
    const router = await start(() => response.promise);
    await takePhoto();

    const firstPress = fireEvent.press(screen.getByRole("button", { name: "Enviar" }));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await pressBack();
    expect(screen.getByText("Subiendo foto…")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeDisabled();

    await act(async () => {
      response.resolve(apiError(503, "SERVICE_UNAVAILABLE"));
      await firstPress;
    });
    await pressBack();
    expect(await screen.findByRole("button", { name: "Registrar comida" })).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/");
    spy.mockRestore();
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

  it("negado: no queda trabada, puede elegir de la galería o cerrar", async () => {
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
    expect(await screen.findByText("Necesitamos tu cámara")).toBeOnTheScreen();
    await press("Cerrar");
    expect(await screen.findByRole("button", { name: "Registrar comida" })).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/");
  });
});

describe("audio de la preparación", () => {
  const RECORD = `Grabar audio de hasta ${AUDIO_MAX_SECONDS} segundos`;
  const advance = (ms: number) =>
    act(async () => {
      jest.advanceTimersByTime(ms);
    });
  const multipartFields = (call: Call) => [...(call.body as FormData).keys()];

  /** Graba `seconds` y la corta con el botón. */
  async function recordFor(seconds: number) {
    await press(RECORD);
    await screen.findByText("Grabando…");
    await advance(seconds * 1000);
    await press("Detener grabación");
    await screen.findByText("Audio grabado");
  }

  it("graba, se escucha y se manda con la foto en el mismo POST", async () => {
    const response = deferred<Response>();
    await start(() => response.promise);
    await takePhoto();

    await press(RECORD);
    expect(await screen.findByText("Grabando…")).toBeOnTheScreen();
    expect(screen.getByText("Quedan 1:00")).toBeOnTheScreen();
    expect(mockAudio.setAudioModeAsync).toHaveBeenCalledWith({
      allowsRecording: true,
      playsInSilentMode: true,
    });
    expect(mockAudio.recorder.record).toHaveBeenCalledWith({ forDuration: AUDIO_MAX_SECONDS });
    // Mientras graba no se puede enviar ni cambiar la foto.
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sacar otra" })).toBeDisabled();

    await advance(12_000);
    expect(screen.getByLabelText("Quedan 48 segundos")).toBeOnTheScreen();
    await press("Detener grabación");
    expect(await screen.findByText("Audio grabado")).toBeOnTheScreen();
    expect(mockAudio.setAudioModeAsync).toHaveBeenLastCalledWith({
      allowsRecording: false,
      playsInSilentMode: true,
    });

    await press("Escuchar audio");
    expect(mockAudio.player.play).toHaveBeenCalledTimes(1);
    await press("Pausar audio");
    await press("Escuchar audio");

    const sending = fireEvent.press(screen.getByRole("button", { name: "Enviar" }));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(screen.getByText("Subiendo foto y audio…")).toBeOnTheScreen();
    // Al enviar se frena la reproducción.
    expect(mockAudio.player.playing).toBe(false);

    await act(async () => {
      response.resolve(accepted());
      await sending;
    });
    expect(await screen.findByText("Analizando tu comida…")).toBeOnTheScreen();
    expect(mealPosts()).toHaveLength(1);
    expect(multipartFields(mealPosts()[0])).toEqual(["photo", "audio"]);
    // Los dos últimos `File` son los del multipart (antes, preparePhoto lee el peso de la foto).
    expect(mockFiles.slice(-2)).toEqual([mockPhoto.uri, "file:///cache/ExpoAudio/toma-1.m4a"]);
  });

  it("corta sola a los 60 s y avisa el tiempo restante sin repetirse", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    await start();
    await takePhoto();

    await press(RECORD);
    await screen.findByText("Grabando…");
    // Por tramos, como los va viendo la pantalla: cada `act` es un render.
    for (let second = 0; second < 59; second++) await advance(1_000);
    expect(screen.getByText("Quedan 0:01")).toBeOnTheScreen();
    expect(mockAudio.recorder.stop).not.toHaveBeenCalled();

    await advance(1_000);
    expect(await screen.findByText("Audio grabado")).toBeOnTheScreen();
    expect(screen.getByText(LIMIT_MESSAGE)).toBeOnTheScreen();
    expect(mockAudio.recorder.stop).toHaveBeenCalledTimes(1);
    expect(announce.mock.calls.map(([message]) => message)).toEqual([
      "Quedan 30 segundos",
      "Quedan 10 segundos",
      `Grabación terminada. ${LIMIT_MESSAGE}`,
    ]);
    announce.mockRestore();
  });

  it("si el corte nativo llega primero, queda grabado una sola vez", async () => {
    await start();
    await takePhoto();

    await press(RECORD);
    await screen.findByText("Grabando…");
    await advance(AUDIO_MAX_SECONDS * 1000 - 1);
    await act(async () => mockAudio.recorder.finishNatively());
    expect(await screen.findByText(LIMIT_MESSAGE)).toBeOnTheScreen();

    // El respaldo del timer ya no hace nada.
    await advance(1_000);
    expect(mockAudio.recorder.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Audio grabado")).toBeOnTheScreen();
  });

  it("regrabar reemplaza la toma y descartar deja mandar solo la foto", async () => {
    await start();
    await takePhoto();
    await recordFor(5);

    await press("Escuchar audio");
    await press("Regrabar audio");
    expect(await screen.findByText("Grabando…")).toBeOnTheScreen();
    expect(mockAudio.player.playing).toBe(false);
    await advance(3_000);
    await press("Detener grabación");
    expect(await screen.findByText("Audio grabado")).toBeOnTheScreen();
    expect(mockAudio.player.source).toEqual({ uri: "file:///cache/ExpoAudio/toma-2.m4a" });

    const alerts = spyAlerts();
    await press("Descartar audio");
    expect(alerts.last().title).toBe("¿Descartar el audio?");
    await alerts.press("Cancelar");
    expect(screen.getByText("Audio grabado")).toBeOnTheScreen();

    await press("Descartar audio");
    await alerts.press("Descartar");
    expect(await screen.findByText("Contá cómo la preparaste")).toBeOnTheScreen();
    expect(mockAudio.player.source).toBeNull();

    await press("Enviar");
    expect(await screen.findByText("Analizando tu comida…")).toBeOnTheScreen();
    expect(multipartFields(mealPosts()[0])).toEqual(["photo"]);
  });

  it("una toma de menos de un segundo no queda", async () => {
    await start();
    await takePhoto();

    await press(RECORD);
    await screen.findByText("Grabando…");
    await advance(400);
    await press("Detener grabación");
    expect(await screen.findByText(TOO_SHORT_ERROR)).toBeOnTheScreen();
    expect(screen.getByText("Contá cómo la preparaste")).toBeOnTheScreen();
  });

  it("si la app pasa a segundo plano mientras graba, corta y conserva lo grabado", async () => {
    // Se reemplaza a mano: `mockRestore` sobre el jest.fn del preset le borra la implementación.
    type AppStateListener = (state: AppStateStatus) => void;
    const listeners: AppStateListener[] = [];
    const addEventListener = AppState.addEventListener;
    AppState.addEventListener = ((_event: string, listener: AppStateListener) => {
      listeners.push(listener);
      return { remove: () => listeners.splice(listeners.indexOf(listener), 1) };
    }) as typeof AppState.addEventListener;
    try {
      await start();
      await takePhoto();

      await press(RECORD);
      await screen.findByText("Grabando…");
      await advance(8_000);
      await act(async () => {
        for (const listener of [...listeners]) listener("background");
      });
      expect(await screen.findByText("Audio grabado")).toBeOnTheScreen();
      expect(mockAudio.recorder.stop).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(LIMIT_MESSAGE)).toBeNull();
    } finally {
      AppState.addEventListener = addEventListener;
    }
  });

  it("con un audio grabado, Cerrar pregunta antes de descartarlo", async () => {
    const router = await start();
    await takePhoto();
    await recordFor(5);
    const alerts = spyAlerts();

    await press("Cerrar");
    expect(alerts.last().title).toBe("¿Descartar la foto y el audio?");
    expect(alerts.last().buttons.map((button) => button.text)).toEqual(["Cancelar", "Descartar"]);
    await alerts.press("Cancelar");
    expect(router.getPathname()).toBe("/capture");
    expect(screen.getByText("Audio grabado")).toBeOnTheScreen();

    await press("Cerrar");
    await alerts.press("Descartar");
    expect(await screen.findByRole("button", { name: "Registrar comida" })).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/");
    expect(mealPosts()).toHaveLength(0);
  });

  it("con un audio grabado, el atrás de Android pregunta lo mismo que Cerrar", async () => {
    const { pressBack, spy } = mockHardwareBack();
    const router = await start();
    await takePhoto();
    await recordFor(5);
    const alerts = spyAlerts();

    await pressBack();
    expect(alerts.last().title).toBe("¿Descartar la foto y el audio?");
    await alerts.press("Cancelar");
    expect(router.getPathname()).toBe("/capture");

    await pressBack();
    await alerts.press("Descartar");
    expect(router.getPathname()).toBe("/");
    spy.mockRestore();
  });

  it("salir de la pantalla mientras graba corta la grabación", async () => {
    const router = await start();
    await takePhoto();

    await press(RECORD);
    await screen.findByText("Grabando…");
    await press("Cerrar");
    expect(await screen.findByRole("button", { name: "Registrar comida" })).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/");
    expect(mockAudio.recorder.stop).toHaveBeenCalledTimes(1);
    expect(mockAudio.setAudioModeAsync).toHaveBeenLastCalledWith({
      allowsRecording: false,
      playsInSilentMode: true,
    });
  });

  it("Sacar otra conserva el audio y frena la reproducción", async () => {
    await start();
    await takePhoto();
    await recordFor(5);
    await press("Escuchar audio");

    await press("Sacar otra");
    expect(mockAudio.player.playing).toBe(false);
    await press("Sacar foto");
    expect(await screen.findByText("Audio grabado")).toBeOnTheScreen();

    await press("Enviar");
    expect(await screen.findByText("Analizando tu comida…")).toBeOnTheScreen();
    expect(multipartFields(mealPosts()[0])).toEqual(["photo", "audio"]);
  });

  it("con audio, un 400 no le echa la culpa solo a la foto", async () => {
    await start(() => apiError(400, "VALIDATION_ERROR"));
    await takePhoto();
    await recordFor(5);

    await press("Enviar");
    expect(
      await screen.findByText(
        "No pudimos leer la foto o el audio. Probá regrabar el audio o enviá solo la foto.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText("Audio grabado")).toBeOnTheScreen();
  });

  it("sin audio, el 400 sigue hablando de la foto", async () => {
    await start(() => apiError(400, "VALIDATION_ERROR"));
    await takePhoto();

    await press("Enviar");
    expect(await screen.findByText("No pudimos leer esta foto. Probá con otra.")).toBeOnTheScreen();
  });

  it("con el micrófono negado avisa y se puede mandar solo la foto", async () => {
    mockAudio.permission = { granted: false, status: "denied", canAskAgain: true };
    await start();
    await takePhoto();

    await press(RECORD);
    expect(
      await screen.findByText(
        "Sin acceso al micrófono no podemos grabar el audio. Igual podés enviar solo la foto.",
      ),
    ).toBeOnTheScreen();
    expect(mockAudio.recorder.record).not.toHaveBeenCalled();

    await press("Enviar");
    expect(await screen.findByText("Analizando tu comida…")).toBeOnTheScreen();
    expect(multipartFields(mealPosts()[0])).toEqual(["photo"]);
  });

  it("negado sin volver a preguntar, lleva a la configuración", async () => {
    mockAudio.permission = { granted: false, status: "denied", canAskAgain: false };
    const openSettings = jest.spyOn(Linking, "openSettings").mockClear().mockResolvedValue();
    await start();
    await takePhoto();

    await press(RECORD);
    await press("Abrir configuración");
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Enviar" })).toBeEnabled();
    openSettings.mockRestore();
  });
});

describe("sin cupo según el interruptor de pagos", () => {
  describe.each([["true"], [undefined]])("prendido (%p)", (value) => {
    billingSwitch(value);

    it("la vista previa ofrece Ver planes", async () => {
      await start(() => apiError(402, "MEAL_QUOTA_EXCEEDED"));
      await takePhoto();

      await press("Enviar");
      expect(await screen.findByText("Usaste los análisis de este mes")).toBeOnTheScreen();
      expect(screen.getByRole("button", { name: "Ver planes" })).toBeOnTheScreen();
    });
  });

  describe("apagado (build de Google Play)", () => {
    billingSwitch("false");

    it("la vista previa dice cuándo se renuevan, sin Ver planes", async () => {
      const router = await start(() => apiError(402, "MEAL_QUOTA_EXCEEDED"));
      await takePhoto();

      await press("Enviar");
      expect(await screen.findByText("Usaste los análisis de este mes")).toBeOnTheScreen();
      expect(
        screen.getByText(
          /^Se renuevan el 1\.º de \S+( de \d{4})?\. Tu historial y tus metas siguen disponibles\.$/,
        ),
      ).toBeOnTheScreen();
      expect(screen.queryByRole("button", { name: "Ver planes" })).toBeNull();
      expectNoPaymentText();
      expect(router.getPathname()).toBe("/capture");
    });
  });
});

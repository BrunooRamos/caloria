import { act, fireEvent, renderRouter, screen, within } from "expo-router/testing-library";
import { AccessibilityInfo, Animated, Platform, StyleSheet } from "react-native";
import { createHttpClient } from "@/services/http-client";
import type { HttpClient } from "@/services/http-client";
import type { WeeklySummary } from "@/services/summaries";
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

// La semana por defecto se calcula en la zona del usuario.
jest.mock("expo-localization", () => ({
  getCalendars: () => [{ timeZone: "America/Montevideo" }],
}));

const mockCaptureRef = jest.fn();
jest.mock("react-native-view-shot", () => ({
  captureRef: (...args: unknown[]) => mockCaptureRef(...args),
}));

const mockShareAsync = jest.fn();
const mockIsAvailableAsync = jest.fn();
jest.mock("expo-sharing", () => ({
  shareAsync: (...args: unknown[]) => mockShareAsync(...args),
  isAvailableAsync: () => mockIsAvailableAsync(),
}));

/** Archivos borrados con `new File(uri).delete()`. */
const mockDeleted: string[] = [];
jest.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///cache/" } },
  File: class {
    uri: string;
    constructor(parent: string | { uri: string }, name?: string) {
      this.uri = typeof parent === "string" ? parent : `${parent.uri}${name}`;
    }
    get exists() {
      return true;
    }
    moveSync(destination: { uri: string }) {
      this.uri = destination.uri;
    }
    delete() {
      mockDeleted.push(this.uri);
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

/** La captura, ya movida al caché con un nombre legible: la de la primera tarjeta. */
const SHARED_FILE = "file:///cache/CalorIA-2026-W43-semana.png";

// Lunes 2 de noviembre de 2026, 02:00 UTC: en Montevideo todavía es domingo 1 (semana 2026-W44).
const NOW = new Date("2026-11-02T02:00:00Z");

/** El ejemplo de docs/api.md (#86). */
const summary: WeeklySummary = {
  week: "2026-W43",
  from: "2026-10-19",
  to: "2026-10-25",
  metrics: { avgKcal: 1840, daysLogged: 6, streak: 5, topDish: "Milanesa con puré" },
  insights: [
    "Registraste 6 de los 7 días: la app ya es parte de tu semana.",
    "De martes a sábado no cortaste: 5 días seguidos.",
    "La milanesa con puré fue la que más se repitió.",
  ],
  generatedAt: "2026-10-26T09:00:12.000Z",
};

let calls: Call[];
const summaryCalls = () => calls.filter((call) => call.path.startsWith("/summaries/weekly/"));

function start(url: string, responses: (() => Response | Promise<Response>)[]) {
  mockTokenStorage = memoryStorage(OLD_TOKENS);
  let index = 0;
  const fake = fakeFetch((call) => {
    if (call.path === "/auth/refresh") return json(200, { ...NEW_TOKENS });
    if (call.path.startsWith("/summaries/weekly/")) {
      return responses[Math.min(index++, responses.length - 1)]();
    }
    return apiError(404, "NOT_FOUND");
  });
  calls = fake.calls;
  mockApi = createHttpClient({ baseUrl: BASE_URL, storage: mockTokenStorage, fetch: fake.fetch });
  return renderRouter("./src/app", { initialUrl: url });
}

/** El pager mide su ancho con onLayout; en los tests hay que dispararlo. */
async function layoutPager() {
  const pager = await screen.findByTestId("wrapped-pager");
  await act(async () =>
    fireEvent(pager, "layout", { nativeEvent: { layout: { width: 350, height: 600 } } }),
  );
}

const layout = (height: number) => ({ nativeEvent: { layout: { width: 312, height } } });

/**
 * La versión para compartir se captura después del layout (el lienzo, el lugar para el texto y el
 * texto) y de que cargue el logo. `text` más alto que `area` es texto que no entra.
 */
async function readyShareCard({ area = 400, text = 200 } = {}) {
  const hidden = { includeHiddenElements: true };
  const card = await screen.findByTestId("share-card", hidden);
  await act(async () => fireEvent(card, "layout", layout(640)));
  await act(async () =>
    fireEvent(screen.getByTestId("share-card-area", hidden), "layout", layout(area)),
  );
  await act(async () =>
    fireEvent(screen.getByTestId("share-card-text", hidden), "layout", layout(text)),
  );
  // El logo de la tarjeta: el inicio, debajo, tiene el suyo.
  const logo = within(card).getByLabelText("CalorIA", hidden);
  await act(async () => fireEvent(logo, "load"));
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  mockCaptureRef.mockReset().mockResolvedValue("/tmp/ReactNative-snapshot-image.png");
  mockShareAsync.mockReset().mockResolvedValue(undefined);
  mockIsAvailableAsync.mockReset().mockResolvedValue(true);
  mockDeleted.length = 0;
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("Wrapped: qué semana pide", () => {
  it("sin semana en la ruta pide la última completa en la zona del usuario", async () => {
    await start("/wrapped", [() => json(200, summary)]);

    // Es la pestaña "Semana": lleva su título y la semana abajo.
    expect(await screen.findByRole("header", { name: "Tu semana" })).toBeOnTheScreen();
    expect(screen.getByText("19–25 de octubre")).toBeOnTheScreen();
    expect(summaryCalls().map((call) => call.path)).toEqual(["/summaries/weekly/2026-W43"]);
  });

  it("con semana en la ruta (como la abre el push) pide esa", async () => {
    await start("/wrapped/2026-W40", [() => json(200, { ...summary, week: "2026-W40" })]);

    expect(await screen.findByRole("header", { name: "Tu semana" })).toBeOnTheScreen();
    expect(screen.getByText("28 de septiembre–4 de octubre")).toBeOnTheScreen();
    expect(summaryCalls().map((call) => call.path)).toEqual(["/summaries/weekly/2026-W40"]);
  });

  it("una semana inválida o que todavía no terminó cae en la última completa", async () => {
    await start("/wrapped/2026-W44", [() => json(200, summary)]);

    expect(await screen.findByText("19–25 de octubre")).toBeOnTheScreen();
    expect(summaryCalls().map((call) => call.path)).toEqual(["/summaries/weekly/2026-W43"]);
  });
});

describe("Wrapped: estados de la respuesta", () => {
  it("mientras carga muestra el esqueleto", async () => {
    const response = deferred<Response>();
    await start("/wrapped/2026-W43", [() => response.promise]);

    expect(await screen.findByLabelText("Cargando tu semana")).toBeOnTheScreen();

    await act(async () => response.resolve(json(200, summary)));
    await layoutPager();
    expect(screen.queryByLabelText("Cargando tu semana")).toBeNull();
  });

  it("200: cuatro tarjetas, cada una legible entera por el lector de pantalla", async () => {
    await start("/wrapped/2026-W43", [() => json(200, summary)]);
    await layoutPager();

    const labels = [
      "Tu semana: registraste 6 de 7 días. Tu mejor racha: 5 días seguidos. Tarjeta 1 de 4.",
      "Promedio por día registrado: 1840 kilocalorías. Tarjeta 2 de 4.",
      "Tu plato más repetido: Milanesa con puré. Tarjeta 3 de 4.",
      `Lo que vimos en tu semana: ${summary.insights.join(" ")} Tarjeta 4 de 4.`,
    ];
    for (const label of labels) expect(screen.getByLabelText(label)).toBeOnTheScreen();

    // Los insights se muestran tal cual llegan.
    for (const insight of summary.insights) expect(screen.getByText(insight)).toBeOnTheScreen();
    expect(screen.getByText("1.840")).toBeOnTheScreen();
    expect(screen.getAllByRole("button", { name: /^Compartir tarjeta \d$/ })).toHaveLength(4);
  });

  it("el plato muestra la foto si viene y, si no carga, la ilustración", async () => {
    const photo = "https://fotos.test/plato.jpg";
    await start("/wrapped/2026-W43", [() => json(200, { ...summary, topDishPhotoUrl: photo })]);
    await layoutPager();

    const image = screen.getByTestId("dish-photo", { includeHiddenElements: true });
    expect(image.props.source).toEqual({ uri: photo });

    await act(async () => fireEvent(image, "error"));
    expect(screen.queryByTestId("dish-photo", { includeHiddenElements: true })).toBeNull();
  });

  it("404 (pending, failed o sin registros): un aviso tranquilo y se puede volver a pedir", async () => {
    await start("/wrapped/2026-W43", [() => apiError(404, "NOT_FOUND"), () => json(200, summary)]);

    expect(await screen.findByText("Todavía no hay resumen de esta semana")).toBeOnTheScreen();
    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Actualizar" })));
    await layoutPager();
    expect(await screen.findByText("1.840")).toBeOnTheScreen();
    expect(summaryCalls()).toHaveLength(2);
  });

  it("402 PREMIUM_REQUIRED: dice que es premium, sin botón de compra", async () => {
    await start("/wrapped/2026-W43", [() => apiError(402, "PREMIUM_REQUIRED")]);

    expect(await screen.findByText("El resumen semanal es parte de premium")).toBeOnTheScreen();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByRole("button").map((button) => button.props.accessibilityLabel)).toEqual(
      expect.not.arrayContaining([expect.stringMatching(/premium|suscrib|plan|comprar/i)]),
    );
    // Sin botones de más: se sale con "Volver" del header, como en cualquier detalle.
    expect(screen.getByRole("button", { name: "Volver" })).toBeOnTheScreen();
  });

  it("500: el mensaje de error y reintentar", async () => {
    await start("/wrapped/2026-W43", [
      () => apiError(500, "INTERNAL_ERROR"),
      () => json(200, summary),
    ]);

    expect(
      await screen.findByText("Algo falló de nuestro lado. Probá de nuevo en un rato."),
    ).toBeOnTheScreen();

    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Reintentar" })));
    await layoutPager();
    expect(await screen.findByText("1.840")).toBeOnTheScreen();
  });

  it("sin conexión: el mensaje de red", async () => {
    await start("/wrapped/2026-W43", [
      () => Promise.reject(new TypeError("Network request failed")),
    ]);

    expect(
      await screen.findByText("No hay conexión. Revisá tu internet y probá de nuevo."),
    ).toBeOnTheScreen();
  });
});

describe("Wrapped: compartir una tarjeta", () => {
  async function openPreview() {
    await start("/wrapped/2026-W43", [() => json(200, summary)]);
    await layoutPager();
    await act(async () =>
      fireEvent.press(screen.getByRole("button", { name: "Compartir tarjeta 1" })),
    );
    await readyShareCard();
    return screen.findByRole("header", { name: "Vista previa" });
  }

  it("captura la versión para compartir en tamaño historia y muestra el archivo antes de subirlo", async () => {
    await openPreview();

    expect(mockCaptureRef).toHaveBeenCalledTimes(1);
    expect(mockCaptureRef.mock.calls[0][1]).toMatchObject({ format: "png", result: "tmpfile" });
    const preview = screen.getByLabelText(/^Imagen para compartir\. Tu semana/);
    expect(preview.props.source).toEqual({ uri: SHARED_FILE });
    expect(screen.getByText(/Cualquiera que la reciba va a poder ver lo que muestra/)).toBeTruthy();
    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it("al compartir abre la hoja del sistema con la imagen y después borra el archivo", async () => {
    await openPreview();

    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Compartir" })));

    expect(mockShareAsync).toHaveBeenCalledWith(SHARED_FILE, {
      mimeType: "image/png",
      UTI: "public.png",
      dialogTitle: "Compartir tu semana",
    });
    expect(mockDeleted).toEqual([SHARED_FILE]);
    expect(screen.queryByRole("header", { name: "Vista previa" })).toBeNull();
  });

  it("en Android no lo borra apenas vuelve la hoja: espera a salir de la pantalla", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    await openPreview();

    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Compartir" })));
    // La app de destino todavía puede estar leyendo el archivo.
    expect(mockShareAsync).toHaveBeenCalledTimes(1);
    expect(mockDeleted).toEqual([]);

    await act(async () => screen.unmount());
    expect(mockDeleted).toEqual([SHARED_FILE]);
  });

  it("al cancelar no comparte nada y borra el archivo", async () => {
    await openPreview();

    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Cancelar" })));

    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(mockDeleted).toEqual([SHARED_FILE]);
    expect(screen.queryByRole("header", { name: "Vista previa" })).toBeNull();
  });

  it("con foto del plato, espera a que cargue antes de capturar", async () => {
    const photo = "https://fotos.test/plato.jpg";
    await start("/wrapped/2026-W43", [() => json(200, { ...summary, topDishPhotoUrl: photo })]);
    await layoutPager();
    await act(async () =>
      fireEvent.press(screen.getByRole("button", { name: "Compartir tarjeta 3" })),
    );
    await readyShareCard();
    expect(mockCaptureRef).not.toHaveBeenCalled();

    // La foto de la versión para compartir es la segunda: la primera está en la tarjeta.
    const photos = screen.getAllByTestId("dish-photo", { includeHiddenElements: true });
    await act(async () => fireEvent(photos[photos.length - 1], "load"));
    expect(await screen.findByRole("header", { name: "Vista previa" })).toBeOnTheScreen();
    expect(mockCaptureRef).toHaveBeenCalledTimes(1);
  });

  it("si los insights no entran en la imagen, los achica en vez de cortarlos", async () => {
    // La captura queda pendiente para revisar la versión para compartir antes de que se desmonte.
    const captured = deferred<string>();
    mockCaptureRef.mockReturnValue(captured.promise);
    await start("/wrapped/2026-W43", [() => json(200, summary)]);
    await layoutPager();
    await act(async () =>
      fireEvent.press(screen.getByRole("button", { name: "Compartir tarjeta 4" })),
    );
    await readyShareCard({ area: 300, text: 600 });

    const text = screen.getByTestId("share-card-text", { includeHiddenElements: true });
    expect(StyleSheet.flatten(text.props.style).transform).toEqual([{ scale: 0.5 }]);
    expect(mockCaptureRef).toHaveBeenCalledTimes(1);

    await act(async () => captured.resolve("/tmp/ReactNative-snapshot-image.png"));
    expect(await screen.findByRole("header", { name: "Vista previa" })).toBeOnTheScreen();
  });

  it("si sale de la pantalla mientras captura, borra la captura igual", async () => {
    const captured = deferred<string>();
    mockCaptureRef.mockReturnValue(captured.promise);
    await start("/wrapped/2026-W43", [() => json(200, summary)]);
    await layoutPager();
    await act(async () =>
      fireEvent.press(screen.getByRole("button", { name: "Compartir tarjeta 1" })),
    );
    await readyShareCard();
    expect(mockCaptureRef).toHaveBeenCalledTimes(1);

    await act(async () => screen.unmount());
    await act(async () => captured.resolve("/tmp/ReactNative-snapshot-image.png"));

    expect(mockDeleted).toEqual(["file:///tmp/ReactNative-snapshot-image.png"]);
  });

  it("si la captura falla, lo dice y no abre la vista previa", async () => {
    mockCaptureRef.mockRejectedValue(new Error("snapshot failed"));
    await start("/wrapped/2026-W43", [() => json(200, summary)]);
    await layoutPager();

    await act(async () =>
      fireEvent.press(screen.getByRole("button", { name: "Compartir tarjeta 2" })),
    );
    await readyShareCard();

    expect(await screen.findByText("No pudimos armar la imagen. Probá de nuevo.")).toBeTruthy();
    expect(screen.queryByRole("header", { name: "Vista previa" })).toBeNull();
  });

  it("si el dispositivo no permite compartir, lo dice y borra el archivo", async () => {
    mockIsAvailableAsync.mockResolvedValue(false);
    await openPreview();

    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Compartir" })));

    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(screen.getByText("Este dispositivo no permite compartir desde la app.")).toBeTruthy();
    expect(mockDeleted).toEqual([SHARED_FILE]);
  });
});

describe("Wrapped: reducir movimiento", () => {
  it("con reducir movimiento prendido no anima la entrada de las tarjetas ni la vista previa", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const timing = jest.spyOn(Animated, "timing");
    await start("/wrapped/2026-W43", [() => json(200, summary)]);
    await layoutPager();
    await act(async () =>
      fireEvent.press(screen.getByRole("button", { name: "Compartir tarjeta 1" })),
    );
    await readyShareCard();

    expect(await screen.findByRole("header", { name: "Vista previa" })).toBeOnTheScreen();
    expect(timing).not.toHaveBeenCalled();
  });

  it("sin reducir movimiento, la primera tarjeta entra animada", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    const timing = jest.spyOn(Animated, "timing");
    await start("/wrapped/2026-W43", [() => json(200, summary)]);
    await layoutPager();

    await screen.findByLabelText(/^Tu semana: registraste/);
    expect(timing).toHaveBeenCalled();
  });
});

import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import type { AppStateStatus, NativeEventSubscription } from "react-native";
import { ApiError } from "@/services/api-error";
import { getMeal } from "@/services/meals";
import type { Meal } from "@/services/meals";
import { MealCacheProvider } from "@/store/meals";
import { POLLING } from "../polling";
import { useMealPolling } from "../useMealPolling";

jest.mock("@/services/meals", () => ({ getMeal: jest.fn() }));
const mockedGetMeal = jest.mocked(getMeal);

const base = { id: "m1", capturedAt: "2026-10-26T13:05:00.000Z", photoUrl: "https://media/x" };
const processing: Meal = { ...base, status: "processing" };
const ready: Meal = {
  ...base,
  status: "ready",
  dish: "Milanesa con puré",
  items: [],
  kcal: { min: 620, max: 780 },
  macros: { protein: { min: 38, max: 46 }, carbs: { min: 50, max: 65 }, fat: { min: 28, max: 38 } },
  confidence: 0.72,
};
const failed: Meal = { ...base, status: "failed", error: { code: "NOT_FOOD" } };
const apiError = (status: number, code: "NOT_FOUND" | "NETWORK_ERROR") =>
  new ApiError({ status, code, message: code, requestId: null });

let setAppState: (state: AppStateStatus) => Promise<void>;

beforeEach(() => {
  jest.useFakeTimers();
  mockedGetMeal.mockReset().mockResolvedValue(processing);
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    setAppState = (state) => act(() => listener(state));
    return { remove: jest.fn() } as unknown as NativeEventSubscription;
  });
});

afterEach(() => {
  jest.useRealTimers();
});

const calls = () => mockedGetMeal.mock.calls.length;
/** Avanza el reloj falso y deja resolver las consultas que se disparen. */
const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

async function start(enabled = true) {
  // En RNTL 14 renderHook, act y rerender devuelven promesas: hay que esperarlas.
  const hook = await renderHook((props: { enabled: boolean }) => useMealPolling("m1", props), {
    initialProps: { enabled },
    wrapper: MealCacheProvider,
  });
  await advance(0);
  return hook;
}

describe("useMealPolling", () => {
  it("consulta enseguida y después cada vez más espaciado: 1 s, 1,5 s, 2,25 s…", async () => {
    await start();
    expect(calls()).toBe(1);

    await advance(999);
    expect(calls()).toBe(1);
    await advance(1);
    expect(calls()).toBe(2);
    await advance(1500);
    expect(calls()).toBe(3);
    await advance(2250);
    expect(calls()).toBe(4);
  });

  it("corta apenas llega ready", async () => {
    mockedGetMeal.mockResolvedValueOnce(processing).mockResolvedValueOnce(ready);
    const { result } = await start();
    await advance(1000);

    expect(result.current.meal).toEqual(ready);
    await advance(10 * 60_000);
    expect(calls()).toBe(2);
  });

  it("corta apenas llega failed", async () => {
    mockedGetMeal.mockResolvedValueOnce(failed);
    const { result } = await start();

    expect(result.current.meal).toEqual(failed);
    await advance(10 * 60_000);
    expect(calls()).toBe(1);
  });

  it("un 404 corta y marca notFound", async () => {
    mockedGetMeal.mockRejectedValueOnce(apiError(404, "NOT_FOUND"));
    const { result } = await start();

    expect(result.current.notFound).toBe(true);
    await advance(60_000);
    expect(calls()).toBe(1);
  });

  it("en segundo plano se pausa y al volver consulta enseguida, desde el mismo intervalo", async () => {
    await start();
    await setAppState("background");
    await advance(5_000);
    expect(calls()).toBe(1);

    await setAppState("active");
    await advance(0);
    expect(calls()).toBe(2);
    // El primer intervalo (1 s) ya se usó: sigue con 1,5 s. El tiempo en segundo plano cuenta
    // (el análisis sigue en el servidor): después de 30 s ya volvería en modo lento.
    await advance(1499);
    expect(calls()).toBe(2);
    await advance(1);
    expect(calls()).toBe(3);
  });

  it("también se pausa en inactive (iOS: centro de control, cambio de app)", async () => {
    await start();
    await setAppState("inactive");
    await advance(60_000);
    expect(calls()).toBe(1);
  });

  it("se pausa cuando la pantalla pierde el foco y se reanuda al volver", async () => {
    const { rerender } = await start();
    await rerender({ enabled: false });
    await advance(60_000);
    expect(calls()).toBe(1);

    await rerender({ enabled: true });
    await advance(0);
    expect(calls()).toBe(2);
  });

  it("al pausar cancela la consulta en vuelo", async () => {
    let signal: AbortSignal | undefined;
    mockedGetMeal.mockImplementationOnce((_id, abortSignal) => {
      signal = abortSignal;
      return new Promise<Meal>(() => {});
    });
    await start();
    expect(signal?.aborted).toBe(false);

    await setAppState("background");
    expect(signal?.aborted).toBe(true);
  });

  it("no superpone consultas: la siguiente se agenda cuando termina la anterior", async () => {
    let resolve!: (meal: Meal) => void;
    mockedGetMeal.mockImplementationOnce(() => new Promise<Meal>((done) => (resolve = done)));
    await start();
    await advance(10_000);
    expect(calls()).toBe(1);

    await act(async () => resolve(processing));
    await advance(1000);
    expect(calls()).toBe(2);
  });

  it("un error de red no corta: avisa y sigue consultando", async () => {
    mockedGetMeal.mockRejectedValueOnce(apiError(0, "NETWORK_ERROR"));
    const { result } = await start();
    expect(result.current.connectionIssue).toBe(true);

    await advance(1000);
    expect(calls()).toBe(2);
    expect(result.current.connectionIssue).toBe(false);
  });

  it("pasados 30 s avisa que tarda más y consulta cada 15 s", async () => {
    const { result } = await start();
    await advance(POLLING.slowAfterMs - 1_000);
    expect(result.current.slow).toBe(false);
    // Se avisa en la primera consulta después de los 30 s (el intervalo normal es de hasta 5 s).
    await advance(POLLING.maxDelayMs + 1_000);
    expect(result.current.slow).toBe(true);

    // Desde ahí, exactamente una consulta en cada ventana de 15 s.
    for (let window = 0; window < 3; window++) {
      const before = calls();
      await advance(POLLING.slowDelayMs);
      expect(calls()).toBe(before + 1);
    }
  });

  it("a los 10 min deja de consultar solo y refresh lo retoma", async () => {
    const { result } = await start();
    await advance(POLLING.stallAfterMs + 15_000);
    expect(result.current.stalled).toBe(true);

    const before = calls();
    await advance(60_000);
    expect(calls()).toBe(before);

    await act(() => result.current.refresh());
    await advance(0);
    expect(result.current.stalled).toBe(false);
    expect(calls()).toBe(before + 1);
  });

  it("refresh con la comida lista hace una sola consulta (para renovar la photoUrl)", async () => {
    mockedGetMeal.mockResolvedValue(ready);
    const { result } = await start();

    await act(() => result.current.refresh());
    await advance(60_000);
    expect(calls()).toBe(2);
  });
});

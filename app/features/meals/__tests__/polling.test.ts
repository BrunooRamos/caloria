import { nextDelay, POLLING } from "../polling";

describe("nextDelay", () => {
  it("arranca en 1 s y se espacia ×1,5 hasta 5 s", () => {
    const delays = [0, 1, 2, 3, 4, 5, 6].map((attempt) => nextDelay(attempt, 0));
    expect(delays).toEqual([1000, 1500, 2250, 3375, 5000, 5000, 5000]);
  });

  it("después de 30 s consulta cada 15 s, sea cual sea el intento", () => {
    expect(nextDelay(0, POLLING.slowAfterMs)).toBe(15_000);
    expect(nextDelay(20, POLLING.slowAfterMs + 60_000)).toBe(15_000);
    expect(nextDelay(3, POLLING.slowAfterMs - 1)).toBe(3375);
  });
});

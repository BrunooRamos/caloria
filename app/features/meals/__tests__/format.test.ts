import { formatClock, formatRange } from "../format";

describe("formatRange", () => {
  it.each([
    [{ min: 620, max: 780 }, "kcal", "620–780 kcal"],
    [{ min: 38, max: 46 }, "g", "38–46 g"],
    [{ min: 1200, max: 1500 }, "kcal", "1200–1500 kcal"],
    [{ min: 0, max: 5 }, "g", "0–5 g"],
  ])("%o %s → %s", (range, unit, expected) => {
    expect(formatRange(range, unit)).toBe(expected);
  });

  it("usa guion medio sin espacios y la unidad al final", () => {
    expect(formatRange({ min: 1, max: 2 }, "g")).toMatch(/^1–2 g$/);
  });

  it("redondea cada extremo al entero", () => {
    expect(formatRange({ min: 37.6, max: 46.4 }, "g")).toBe("38–46 g");
    expect(formatRange({ min: 0.4, max: 2.5 }, "g")).toBe("0–3 g");
  });

  it("si min y max son iguales, o quedan iguales al redondear, muestra un solo número", () => {
    expect(formatRange({ min: 620, max: 620 }, "kcal")).toBe("620 kcal");
    expect(formatRange({ min: 9.6, max: 10.4 }, "g")).toBe("10 g");
  });
});

describe("formatClock", () => {
  it.each([
    [60, "1:00"],
    [42, "0:42"],
    [9, "0:09"],
    [0, "0:00"],
    [41.2, "0:42"],
    [-1, "0:00"],
  ])("%d → %s", (seconds, expected) => {
    expect(formatClock(seconds)).toBe(expected);
  });
});

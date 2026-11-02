import {
  daysCount,
  dayUnit,
  formatDailyRange,
  formatNumber,
  mealsCount,
  progressOf,
} from "../format";

describe("formatNumber", () => {
  it("separa los miles con punto, también con cuatro cifras", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(980)).toBe("980");
    expect(formatNumber(1450)).toBe("1.450");
    expect(formatNumber(21000)).toBe("21.000");
    expect(formatNumber(1234567)).toBe("1.234.567");
  });

  it("redondea al entero", () => {
    expect(formatNumber(1449.6)).toBe("1.450");
    expect(formatNumber(52.4)).toBe("52");
  });
});

describe("formatDailyRange", () => {
  it("min–max con guion medio y sin espacios", () => {
    expect(formatDailyRange({ min: 1450, max: 1820 })).toBe("1.450–1.820");
  });

  it("si los extremos coinciden, un solo número", () => {
    expect(formatDailyRange({ min: 0, max: 0 })).toBe("0");
    expect(formatDailyRange({ min: 1200.2, max: 1199.8 })).toBe("1.200");
  });
});

describe("progressOf", () => {
  it("es el punto medio contra la meta", () => {
    expect(progressOf(1050, 2100)).toBe(0.5);
    expect(progressOf(0, 2100)).toBe(0);
  });

  it("pasarse de la meta deja la barra llena, no más", () => {
    expect(progressOf(2100, 2100)).toBe(1);
    expect(progressOf(3500, 2100)).toBe(1);
  });

  it("sin meta válida no llena nada", () => {
    expect(progressOf(500, 0)).toBe(0);
    expect(progressOf(500, Number.NaN)).toBe(0);
  });
});

describe("mealsCount", () => {
  it("singular y plural", () => {
    expect(mealsCount(1)).toBe("1 comida");
    expect(mealsCount(2)).toBe("2 comidas");
  });
});

describe("daysCount", () => {
  it("singular y plural", () => {
    expect(daysCount(1)).toBe("1 día");
    expect(daysCount(4)).toBe("4 días");
    expect(daysCount(0)).toBe("0 días");
    expect(dayUnit(1)).toBe("día");
    expect(dayUnit(12)).toBe("días");
  });
});

import { RANGE_ERRORS, formatRangeInput, parseRange } from "../parse-range";

describe("parseRange", () => {
  it.each([
    ["650", { min: 650, max: 650 }],
    ["  650  ", { min: 650, max: 650 }],
    ["0", { min: 0, max: 0 }],
    ["600-700", { min: 600, max: 700 }],
    ["600 - 700", { min: 600, max: 700 }],
    ["600–700", { min: 600, max: 700 }],
    ["600 – 700", { min: 600, max: 700 }],
    ["600—700", { min: 600, max: 700 }],
    ["600 a 700", { min: 600, max: 700 }],
    ["600a700", { min: 600, max: 700 }],
    ["600 A 700", { min: 600, max: 700 }],
    ["700-700", { min: 700, max: 700 }],
    ["120 g", { min: 120, max: 120 }],
    ["120g", { min: 120, max: 120 }],
    ["100-150 gr", { min: 100, max: 150 }],
    ["600 a 700 kcal", { min: 600, max: 700 }],
    ["300 Kcal", { min: 300, max: 300 }],
  ])("%j es %j", (text, range) => {
    expect(parseRange(text)).toEqual({ range });
  });

  it("un rango escrito al revés se da vuelta", () => {
    expect(parseRange("700-600")).toEqual({ range: { min: 600, max: 700 } });
    expect(parseRange("700 a 600")).toEqual({ range: { min: 600, max: 700 } });
  });

  it("vacío es un error, con el mensaje de quien llama", () => {
    expect(parseRange("")).toEqual({ error: "Ingresá un valor." });
    expect(parseRange("   ", "Ingresá las kcal.")).toEqual({ error: "Ingresá las kcal." });
  });

  it.each(["-5", "- 5", "−5", "-600-700", "600 - -700", "600 a -700"])("%j es negativo", (text) => {
    expect(parseRange(text)).toEqual({ error: RANGE_ERRORS.negative });
  });

  it.each(["12,5", "1.5", "600-700,5"])("%j tiene decimales", (text) => {
    expect(parseRange(text)).toEqual({ error: RANGE_ERRORS.decimal });
  });

  it.each([
    "abc",
    "seiscientos",
    "600-",
    "-",
    "a",
    "600 700",
    "600-700-800",
    "600 litros",
    "g",
    "kcal",
    "1e3",
  ])("%j no se entiende", (text) => {
    expect(parseRange(text)).toEqual({ error: RANGE_ERRORS.invalid });
  });

  it("no pasa de 99 999", () => {
    expect(parseRange("99999")).toEqual({ range: { min: 99999, max: 99999 } });
    expect(parseRange("100000")).toEqual({ error: RANGE_ERRORS.tooLarge });
    expect(parseRange("10-100000")).toEqual({ error: RANGE_ERRORS.tooLarge });
  });
});

describe("formatRangeInput", () => {
  it("un número si los extremos coinciden; si no, el rango con guion", () => {
    expect(formatRangeInput({ min: 650, max: 650 })).toBe("650");
    expect(formatRangeInput({ min: 620, max: 780 })).toBe("620-780");
  });

  it("redondea como el resto de la app", () => {
    expect(formatRangeInput({ min: 37.6, max: 46.2 })).toBe("38-46");
    expect(formatRangeInput({ min: 40.2, max: 39.8 })).toBe("40");
  });

  it("lo que escribe vuelve a leerse igual", () => {
    for (const range of [
      { min: 650, max: 650 },
      { min: 620, max: 780 },
    ]) {
      expect(parseRange(formatRangeInput(range))).toEqual({ range });
    }
  });
});

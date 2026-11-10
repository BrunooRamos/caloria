import {
  dayIn,
  formatDay,
  formatInstantDay,
  formatPrice,
  formatPricePerInterval,
  nextChargeDay,
} from "../format";

const NOW = new Date("2026-11-09T15:00:00.000Z");

describe("formatPrice", () => {
  it.each([
    [{ amount: 499, currency: "USD" }, "US$ 4,99"],
    [{ amount: 500, currency: "USD" }, "US$ 5"],
    [{ amount: 1205, currency: "USD" }, "US$ 12,05"],
    [{ amount: 129000, currency: "UYU" }, "$U 1.290"],
    [{ amount: 499900, currency: "ARS" }, "AR$ 4.999"],
    [{ amount: 1999, currency: "EUR" }, "€ 19,99"],
  ])("%o → %s", (price, expected) => {
    expect(formatPrice(price)).toBe(expected);
  });

  it("una moneda sin símbolo conocido va con su código, nunca con un $ ambiguo", () => {
    expect(formatPrice({ amount: 2500, currency: "BRL" })).toBe("BRL 25");
  });

  it("siempre dice el período", () => {
    expect(formatPricePerInterval({ amount: 499, currency: "USD", interval: "month" })).toBe(
      "US$ 4,99 por mes",
    );
    expect(formatPricePerInterval({ amount: 4990, currency: "USD", interval: "year" })).toBe(
      "US$ 49,90 por año",
    );
  });
});

describe("fechas en la zona del usuario", () => {
  // Las 02:00 UTC del 1/12 todavía son el 30/11 en el Río de la Plata (UTC-3).
  const PERIOD_END = "2026-12-01T02:00:00.000Z";

  it.each([
    ["America/Montevideo", "2026-11-30", "30 de noviembre"],
    ["America/Argentina/Buenos_Aires", "2026-11-30", "30 de noviembre"],
    ["UTC", "2026-12-01", "1 de diciembre"],
    ["Asia/Tokyo", "2026-12-01", "1 de diciembre"],
  ])("en %s el fin del período cae el %s", (timeZone, day, label) => {
    expect(dayIn(PERIOD_END, timeZone)).toBe(day);
    expect(formatInstantDay(PERIOD_END, timeZone, NOW)).toBe(label);
  });

  it("con una zona que el dispositivo no conoce, usa la local en vez de fallar", () => {
    expect(formatInstantDay("2026-12-04T15:00:00.000Z", "Marte/Olympus", NOW)).toMatch(
      /^\d{1,2} de diciembre$/,
    );
  });

  it("suma el año solo si no es el de hoy en esa zona", () => {
    expect(formatInstantDay("2027-01-04T15:00:00.000Z", "America/Montevideo", NOW)).toBe(
      "4 de enero de 2027",
    );
    // El 31/12 a las 22:00 en Montevideo ya es 2027 en UTC: el año de "hoy" también va en la zona.
    const newYearsEve = new Date("2027-01-01T01:00:00.000Z");
    expect(formatInstantDay("2027-01-04T15:00:00.000Z", "America/Montevideo", newYearsEve)).toBe(
      "4 de enero de 2027",
    );
    expect(formatInstantDay("2027-01-04T15:00:00.000Z", "UTC", newYearsEve)).toBe("4 de enero");
  });

  it("resetsOn ya viene en la zona del usuario: no se corre", () => {
    expect(formatDay("2026-12-01", "Asia/Tokyo", NOW)).toBe("1 de diciembre");
    expect(formatDay("2026-12-01", "America/Los_Angeles", NOW)).toBe("1 de diciembre");
  });
});

describe("nextChargeDay", () => {
  it("un período después de hoy en la zona del usuario", () => {
    expect(nextChargeDay("month", "America/Montevideo", NOW)).toBe("9 de diciembre");
    expect(nextChargeDay("year", "America/Montevideo", NOW)).toBe("9 de noviembre de 2027");
  });

  it("el día de hoy es el de la zona: a las 23:30 del 9 en Montevideo ya es el 10 en UTC", () => {
    const lateNight = new Date("2026-11-10T02:30:00.000Z");
    expect(nextChargeDay("month", "America/Montevideo", lateNight)).toBe("9 de diciembre");
    expect(nextChargeDay("month", "UTC", lateNight)).toBe("10 de diciembre");
  });

  it("si el día no existe en el mes siguiente, el último del mes", () => {
    const january31 = new Date("2027-01-31T15:00:00.000Z");
    expect(nextChargeDay("month", "UTC", january31)).toBe("28 de febrero");
  });
});

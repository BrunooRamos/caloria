import { todayIn } from "@/features/history/day";
import {
  isoWeekOf,
  isoWeekRange,
  isValidWeek,
  lastCompleteWeek,
  resolveWeek,
  weekLabel,
} from "../week";

/** La semana por defecto de la pantalla: la última completa, en la zona del usuario. */
const defaultWeek = (timeZone: string, now: string) =>
  lastCompleteWeek(todayIn(timeZone, new Date(now)));

describe("isoWeekOf", () => {
  it.each([
    ["2026-10-19", "2026-W43"], // lunes
    ["2026-10-25", "2026-W43"], // domingo
    ["2026-01-01", "2026-W01"], // jueves: la semana 1 de 2026 empieza en diciembre de 2025
    ["2025-12-29", "2026-W01"],
    ["2027-01-01", "2026-W53"], // viernes: es de la última semana de 2026
    ["2027-01-03", "2026-W53"],
    ["2027-01-04", "2027-W01"],
    ["2021-01-03", "2020-W53"],
    ["2024-12-30", "2025-W01"],
  ])("%s es de %s", (day, week) => {
    expect(isoWeekOf(day)).toBe(week);
  });
});

describe("lastCompleteWeek", () => {
  it.each([
    ["2026-11-02", "2026-W44"], // lunes: la semana que acaba de terminar
    ["2026-11-01", "2026-W43"], // domingo: la semana actual todavía no terminó
    ["2026-01-01", "2025-W52"],
    ["2025-12-29", "2025-W52"], // ya es la semana 1 de 2026: la última completa es de 2025
    ["2027-01-01", "2026-W52"], // todavía es la W53 de 2026
    ["2027-01-04", "2026-W53"], // primer lunes de 2027: la que terminó es la W53
    ["2021-01-04", "2020-W53"],
  ])("el %s es %s", (today, week) => {
    expect(lastCompleteWeek(today)).toBe(week);
  });
});

describe("semana por defecto en distintas zonas horarias", () => {
  it("el mismo instante puede ser domingo en una zona y lunes en otra", () => {
    // Lunes 2 de noviembre de 2026, 02:00 UTC.
    const now = "2026-11-02T02:00:00Z";
    expect(defaultWeek("America/Montevideo", now)).toBe("2026-W43"); // domingo 23:00
    expect(defaultWeek("UTC", now)).toBe("2026-W44");
    expect(defaultWeek("Europe/Madrid", now)).toBe("2026-W44"); // lunes 03:00
  });

  it("en el cambio de año, la zona decide si la última completa es la W52 o la W53", () => {
    // Lunes 4 de enero de 2027, 02:00 UTC.
    const now = "2027-01-04T02:00:00Z";
    expect(defaultWeek("America/Montevideo", now)).toBe("2026-W52"); // domingo 3, sigue la W53
    expect(defaultWeek("Asia/Tokyo", now)).toBe("2026-W53"); // lunes 4, ya es 2027-W01
  });

  it("con zonas en los extremos del día, la semana cambia de año en una y no en la otra", () => {
    // Domingo 28 de diciembre de 2025, 12:00 UTC.
    const now = "2025-12-28T12:00:00Z";
    expect(defaultWeek("Pacific/Kiritimati", now)).toBe("2025-W52"); // lunes 29: 2026-W01
    expect(defaultWeek("Pacific/Pago_Pago", now)).toBe("2025-W51"); // domingo 28 a la 01:00
  });
});

describe("isValidWeek", () => {
  it.each(["2026-W01", "2026-W43", "2026-W53", "2020-W53"])("%s es válida", (week) => {
    expect(isValidWeek(week)).toBe(true);
  });

  it.each(["2025-W53", "2026-W00", "2026-W54", "2026-w43", "2026-43", "2026-W4", "", "latest"])(
    "%j no es válida",
    (week) => {
      expect(isValidWeek(week)).toBe(false);
    },
  );
});

describe("resolveWeek", () => {
  const TODAY = "2026-11-02"; // lunes de la 2026-W45

  it("sin semana usa la última completa", () => {
    expect(resolveWeek(undefined, TODAY)).toBe("2026-W44");
  });

  it("respeta una semana pasada, aunque sea de otro año", () => {
    expect(resolveWeek("2026-W43", TODAY)).toBe("2026-W43");
    expect(resolveWeek("2025-W52", TODAY)).toBe("2025-W52");
    expect(resolveWeek("2020-W53", TODAY)).toBe("2020-W53");
  });

  it("una semana que no terminó (la actual o una futura) cae en la última completa", () => {
    expect(resolveWeek("2026-W45", TODAY)).toBe("2026-W44");
    expect(resolveWeek("2026-W50", TODAY)).toBe("2026-W44");
    expect(resolveWeek("2027-W01", TODAY)).toBe("2026-W44");
  });

  it("una semana inválida cae en la última completa", () => {
    expect(resolveWeek("2025-W53", TODAY)).toBe("2026-W44");
    expect(resolveWeek("2026-W99", TODAY)).toBe("2026-W44");
    expect(resolveWeek("hola", TODAY)).toBe("2026-W44");
  });

  it("la W53 recién terminada vale el primer lunes del año siguiente", () => {
    expect(resolveWeek("2026-W53", "2027-01-04")).toBe("2026-W53");
    expect(resolveWeek("2026-W53", "2027-01-03")).toBe("2026-W52");
  });
});

describe("isoWeekRange", () => {
  it.each([
    ["2026-W43", "2026-10-19", "2026-10-25"],
    ["2026-W01", "2025-12-29", "2026-01-04"],
    ["2026-W53", "2026-12-28", "2027-01-03"],
    ["2020-W53", "2020-12-28", "2021-01-03"],
  ])("%s va del %s al %s", (week, from, to) => {
    expect(isoWeekRange(week)).toEqual({ from, to });
  });

  it("lanza con una semana que no existe", () => {
    expect(() => isoWeekRange("2025-W53")).toThrow("Semana inválida");
  });
});

describe("weekLabel", () => {
  it.each([
    ["2026-W43", "19–25 de octubre"],
    ["2026-W44", "26 de octubre–1 de noviembre"],
    ["2026-W01", "29 de diciembre de 2025–4 de enero de 2026"],
    ["2026-W53", "28 de diciembre de 2026–3 de enero de 2027"],
  ])("%s → %s", (week, label) => {
    expect(weekLabel(week)).toBe(label);
  });
});

import {
  dayTitle,
  formatTime,
  isValidDay,
  nextDay,
  previousDay,
  resolveDay,
  shiftDay,
  todayIn,
} from "../day";

describe("isValidDay", () => {
  it.each(["2026-10-27", "2024-02-29", "2026-01-01"])("%s es un día", (day) => {
    expect(isValidDay(day)).toBe(true);
  });

  it.each(["2026-02-30", "2025-02-29", "2026-13-01", "2026-1-01", "27/10/2026", "", "hoy"])(
    "%s no es un día",
    (day) => {
      expect(isValidDay(day)).toBe(false);
    },
  );
});

describe("todayIn", () => {
  // 2026-10-27 02:30 UTC: en Montevideo (UTC-3) todavía es el 26.
  const now = new Date("2026-10-27T02:30:00Z");

  it("calcula el día en la zona del usuario, no en UTC", () => {
    expect(todayIn("America/Montevideo", now)).toBe("2026-10-26");
    expect(todayIn("UTC", now)).toBe("2026-10-27");
    expect(todayIn("Asia/Tokyo", now)).toBe("2026-10-27");
  });

  it("cruza el año", () => {
    expect(todayIn("America/Montevideo", new Date("2027-01-01T01:00:00Z"))).toBe("2026-12-31");
  });

  it("con una zona que no existe no rompe", () => {
    expect(todayIn("Nada/Inventada", now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("shiftDay / previousDay / nextDay", () => {
  it("cruza meses, años y bisiestos", () => {
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
    expect(previousDay("2024-03-01")).toBe("2024-02-29");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2026-10-27", -7)).toBe("2026-10-20");
  });

  it("no lo corre un cambio de horario", () => {
    // Uruguay no tiene horario de verano, pero muchas zonas sí: las cuentas son en UTC.
    expect(shiftDay("2026-03-29", -1)).toBe("2026-03-28");
    expect(shiftDay("2026-11-01", 1)).toBe("2026-11-02");
  });

  it("nunca avanza más allá de hoy", () => {
    expect(nextDay("2026-10-26", "2026-10-27")).toBe("2026-10-27");
    expect(nextDay("2026-10-27", "2026-10-27")).toBeNull();
    expect(nextDay("2026-10-28", "2026-10-27")).toBeNull();
  });

  it("un día inválido es un error de programación", () => {
    expect(() => shiftDay("2026-02-30", 1)).toThrow();
  });
});

describe("resolveDay", () => {
  const today = "2026-10-27";

  it("usa el día de la ruta si es válido y no es futuro", () => {
    expect(resolveDay("2026-10-20", today)).toBe("2026-10-20");
    expect(resolveDay(today, today)).toBe(today);
  });

  it.each([undefined, "", "2026-10-28", "2030-01-01", "2026-02-30", "ayer"])(
    "%s → hoy",
    (requested) => {
      expect(resolveDay(requested, today)).toBe(today);
    },
  );
});

describe("dayTitle", () => {
  const today = "2026-10-27";

  it("hoy y ayer por su nombre", () => {
    expect(dayTitle("2026-10-27", today)).toBe("Hoy");
    expect(dayTitle("2026-10-26", today)).toBe("Ayer");
  });

  it("el resto con día de la semana, número y mes", () => {
    expect(dayTitle("2026-10-25", today)).toBe("domingo 25 de octubre");
    expect(dayTitle("2026-10-19", today)).toBe("lunes 19 de octubre");
    expect(dayTitle("2026-01-07", today)).toBe("miércoles 7 de enero");
  });

  it("con el año si no es el de hoy", () => {
    expect(dayTitle("2025-12-31", "2026-01-02")).toBe("miércoles 31 de diciembre de 2025");
    expect(dayTitle("2025-12-31", "2026-01-01")).toBe("Ayer");
  });
});

describe("formatTime", () => {
  it("la hora en la zona del usuario, en 24 h", () => {
    expect(formatTime("2026-10-06T13:05:00Z", "America/Montevideo")).toBe("10:05");
    expect(formatTime("2026-10-06T13:05:00Z", "UTC")).toBe("13:05");
    expect(formatTime("2026-10-06T21:40:00Z", "America/Montevideo")).toBe("18:40");
  });

  it("la medianoche es 00, no 24", () => {
    expect(formatTime("2026-10-06T03:07:00Z", "America/Montevideo")).toBe("00:07");
  });

  it("una fecha rota no muestra nada", () => {
    expect(formatTime("no-es-fecha", "UTC")).toBe("");
  });
});

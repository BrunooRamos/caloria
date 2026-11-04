import type { WeeklySummary } from "@/services/summaries";
import { wrappedCards } from "../cards";

const summary = (
  metrics: Partial<WeeklySummary["metrics"]>,
  extra: Partial<WeeklySummary> = {},
): WeeklySummary => ({
  week: "2026-W43",
  from: "2026-10-19",
  to: "2026-10-25",
  metrics: {
    avgKcal: 1840.4,
    daysLogged: 6,
    streak: 5,
    topDish: "Milanesa con puré",
    ...metrics,
  },
  insights: ["Uno.", "Dos.", "Tres."],
  generatedAt: "2026-10-26T09:00:12.000Z",
  ...extra,
});

describe("wrappedCards", () => {
  it("cuatro tarjetas: la semana, el promedio, el plato y los insights juntos", () => {
    const cards = wrappedCards(summary({}, { insights: ["Uno.", "Dos.", "Tres.", "Cuatro."] }));
    expect(cards.map((card) => card.kind)).toEqual(["week", "avgKcal", "topDish", "insights"]);
    expect(cards[3].items).toEqual(["Uno.", "Dos.", "Tres.", "Cuatro."]);
  });

  it("cada dato aparece una sola vez: los días y la racha van juntos, el promedio solo", () => {
    const [week, avg] = wrappedCards(summary({}));
    expect(week).toMatchObject({
      hero: "6",
      unit: "de 7 días",
      detail: "Tu mejor racha: 5 días seguidos",
      filled: 6,
    });
    expect(week.accessibilityLabel).toBe(
      "Tu semana: registraste 6 de 7 días. Tu mejor racha: 5 días seguidos.",
    );
    expect(avg).toMatchObject({ hero: "1.840", unit: "kcal" });
    expect(avg.detail).toBeUndefined();
    // El lector lo oye sin separador de miles.
    expect(avg.accessibilityLabel).toBe("Promedio por día registrado: 1840 kilocalorías.");
  });

  it("sin días seguidos (racha de 1) no muestra racha", () => {
    const [week] = wrappedCards(summary({ daysLogged: 3, streak: 1 }));
    expect(week.detail).toBeUndefined();
    expect(week.accessibilityLabel).toBe("Tu semana: registraste 3 de 7 días.");
  });

  it("el plato lleva la foto si la API la manda", () => {
    const url = "https://fotos.test/plato.jpg";
    expect(wrappedCards(summary({}, { topDishPhotoUrl: url }))[2].photoUrl).toBe(url);
    expect(wrappedCards(summary({}))[2].photoUrl).toBeUndefined();
  });

  it("si el plato viene vacío o no hay insights, esa tarjeta no va", () => {
    expect(wrappedCards(summary({ topDish: "  " })).map((card) => card.kind)).toEqual([
      "week",
      "avgKcal",
      "insights",
    ]);
    expect(wrappedCards(summary({}, { insights: [] })).map((card) => card.kind)).toEqual([
      "week",
      "avgKcal",
      "topDish",
    ]);
  });
});

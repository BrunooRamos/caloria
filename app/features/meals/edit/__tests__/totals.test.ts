import { meal } from "@/test-utils/meals";
import { sumRanges, totalKcal } from "../totals";

const [milanesa, pure] = meal.items.map((item) => item.kcal);

describe("sumRanges", () => {
  it("suma los mínimos y los máximos por separado", () => {
    expect(sumRanges([milanesa, pure])).toEqual({ min: 560, max: 700 });
  });

  it("sin rangos es 0", () => {
    expect(sumRanges([])).toEqual({ min: 0, max: 0 });
  });
});

describe("totalKcal", () => {
  it("con las kcal de los ingredientes como estaban, queda el total que había (no la suma)", () => {
    expect(totalKcal(meal, [milanesa, pure])).toEqual({ kcal: meal.kcal, source: "current" });
  });

  it("si cambian las kcal de un ingrediente, es la suma de los ingredientes", () => {
    expect(totalKcal(meal, [{ min: 420, max: 420 }, pure])).toEqual({
      kcal: { min: 600, max: 650 },
      source: "sum",
    });
  });

  it("si se quita un ingrediente, suma los que quedan", () => {
    expect(totalKcal(meal, [milanesa])).toEqual({ kcal: milanesa, source: "sum" });
  });

  it("si se agrega uno, lo suma", () => {
    expect(totalKcal(meal, [milanesa, pure, { min: 90, max: 120 }])).toEqual({
      kcal: { min: 650, max: 820 },
      source: "sum",
    });
  });

  it("un ingrediente nuevo sin kcal válidas todavía no cuenta ni cambia el total", () => {
    expect(totalKcal(meal, [milanesa, pure, undefined])).toEqual({
      kcal: meal.kcal,
      source: "current",
    });
    expect(totalKcal(meal, [milanesa, undefined, undefined])).toEqual({
      kcal: milanesa,
      source: "sum",
    });
  });

  it("sin ingredientes con kcal, queda el total que había: sumar nada daría 0", () => {
    expect(totalKcal(meal, [])).toEqual({ kcal: meal.kcal, source: "current" });
    expect(totalKcal(meal, [undefined])).toEqual({ kcal: meal.kcal, source: "current" });
  });

  it("el total que escribió la persona se respeta aunque cambien los ingredientes", () => {
    const manual = { min: 900, max: 900 };
    expect(totalKcal(meal, [milanesa], manual)).toEqual({ kcal: manual, source: "manual" });
    expect(totalKcal(meal, [milanesa, pure], manual)).toEqual({ kcal: manual, source: "manual" });
  });

  it("una comida sin ingredientes a la que se le agrega uno pasa a ser su suma", () => {
    const empty = { ...meal, items: [] };
    expect(totalKcal(empty, [])).toEqual({ kcal: meal.kcal, source: "current" });
    expect(totalKcal(empty, [{ min: 300, max: 300 }])).toEqual({
      kcal: { min: 300, max: 300 },
      source: "sum",
    });
  });
});

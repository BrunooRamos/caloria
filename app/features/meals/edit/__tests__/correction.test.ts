import type { MealValues } from "@/services/meals";
import { meal } from "@/test-utils/meals";
import { buildCorrection } from "../correction";

const copy = (): MealValues => structuredClone(meal);

describe("buildCorrection", () => {
  it("sin cambios es null: no hay nada que mandar", () => {
    expect(buildCorrection(meal, copy())).toBeNull();
  });

  it("solo el plato", () => {
    expect(buildCorrection(meal, { ...copy(), dish: "Milanesa napolitana con puré" })).toEqual({
      dish: "Milanesa napolitana con puré",
    });
  });

  it("solo el total", () => {
    expect(buildCorrection(meal, { ...copy(), kcal: { min: 800, max: 800 } })).toEqual({
      kcal: { min: 800, max: 800 },
    });
  });

  it("si cambia un macro, manda los tres", () => {
    const values = copy();
    values.macros.fat = { min: 30, max: 30 };
    expect(buildCorrection(meal, values)).toEqual({
      macros: {
        protein: { min: 38, max: 46 },
        carbs: { min: 50, max: 65 },
        fat: { min: 30, max: 30 },
      },
    });
  });

  it("si cambia un ingrediente, manda la lista entera", () => {
    const values = copy();
    values.items[1].grams = { min: 250, max: 250 };
    expect(buildCorrection(meal, values)).toEqual({
      items: [
        { name: "Milanesa", grams: { min: 150, max: 190 }, kcal: { min: 380, max: 470 } },
        { name: "Puré de papa", grams: { min: 250, max: 250 }, kcal: { min: 180, max: 230 } },
      ],
    });
  });

  it("quitar o agregar un ingrediente cambia la lista", () => {
    expect(buildCorrection(meal, { ...copy(), items: [meal.items[0]] })).toEqual({
      items: [meal.items[0]],
    });
    const extra = { name: "Ensalada", grams: { min: 80, max: 80 }, kcal: { min: 30, max: 30 } };
    expect(buildCorrection(meal, { ...copy(), items: [...meal.items, extra] })).toEqual({
      items: [...meal.items, extra],
    });
    expect(buildCorrection(meal, { ...copy(), items: [] })).toEqual({ items: [] });
  });

  it("varios campos a la vez, sin los que quedaron igual", () => {
    const values = copy();
    values.dish = "Milanesa de pollo con puré";
    values.items[0].name = "Milanesa de pollo";
    values.kcal = { min: 500, max: 650 };
    expect(buildCorrection(meal, values)).toEqual({
      dish: "Milanesa de pollo con puré",
      items: [
        { name: "Milanesa de pollo", grams: { min: 150, max: 190 }, kcal: { min: 380, max: 470 } },
        meal.items[1],
      ],
      kcal: { min: 500, max: 650 },
    });
  });
});

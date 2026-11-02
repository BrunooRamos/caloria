import type { Meal } from "@/services/meals";
import { mealSummary } from "../format";
import { mergePage, removeMeal } from "../pages";

const processing = (id: string, capturedAt = "2026-10-27T12:00:00Z"): Meal => ({
  id,
  status: "processing",
  capturedAt,
  photoUrl: `https://fotos.test/${id}`,
});

const ready = (id: string, dish = "Milanesa con puré"): Meal => ({
  ...processing(id),
  status: "ready",
  dish,
  items: [],
  kcal: { min: 620, max: 780 },
  macros: {
    protein: { min: 38, max: 46 },
    carbs: { min: 50, max: 65 },
    fat: { min: 28, max: 38 },
  },
  confidence: 0.72,
});

const ids = (meals: readonly Meal[]) => meals.map((meal) => meal.id);

describe("mergePage", () => {
  it("suma la página al final, en el orden en que llega", () => {
    expect(
      ids(mergePage([processing("a"), processing("b")], [processing("c"), processing("d")])),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("no repite una comida que ya estaba y se queda con la versión nueva en su lugar", () => {
    const merged = mergePage([processing("a"), processing("b")], [ready("b"), processing("c")]);
    expect(ids(merged)).toEqual(["a", "b", "c"]);
    expect(merged[1].status).toBe("ready");
  });

  it("una página vacía deja la lista igual", () => {
    expect(ids(mergePage([processing("a")], []))).toEqual(["a"]);
    expect(ids(mergePage([], [processing("a")]))).toEqual(["a"]);
  });
});

describe("removeMeal", () => {
  it("saca la comida", () => {
    expect(ids(removeMeal([processing("a"), processing("b"), processing("c")], "b"))).toEqual([
      "a",
      "c",
    ]);
  });

  it("si no estaba, devuelve la misma lista", () => {
    const meals = [processing("a")];
    expect(removeMeal(meals, "x")).toBe(meals);
  });
});

describe("mealSummary", () => {
  it("ready: el plato y las kcal en rango", () => {
    expect(mealSummary(ready("a", "Ensalada César"))).toEqual({
      title: "Ensalada César",
      detail: "620–780 kcal",
    });
  });

  it("processing y failed avisan que no suman, sin alarma", () => {
    expect(mealSummary(processing("a")).title).toBe("Analizando…");
    expect(
      mealSummary({ ...processing("a"), status: "failed", error: { code: "NOT_FOOD" } }),
    ).toEqual({ title: "No se pudo analizar", detail: "No suma en el total del día." });
  });
});

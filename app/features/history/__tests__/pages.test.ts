import type { Meal } from "@/services/meals";
import { mergePage } from "../pages";

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

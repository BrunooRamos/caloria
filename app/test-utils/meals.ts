import type { MealValues } from "@/services/meals";

/** El total (620–780) no es la suma de los ingredientes (560–700): la IA contó el aceite aparte. */
export const meal: MealValues = {
  dish: "Milanesa con puré",
  items: [
    { name: "Milanesa", grams: { min: 150, max: 190 }, kcal: { min: 380, max: 470 } },
    { name: "Puré de papa", grams: { min: 200, max: 200 }, kcal: { min: 180, max: 230 } },
  ],
  kcal: { min: 620, max: 780 },
  macros: { protein: { min: 38, max: 46 }, carbs: { min: 50, max: 65 }, fat: { min: 28, max: 38 } },
};

import type { Meal, MealCorrection, MealItem, MealValues, ReadyMeal } from "@/services/meals";
import { MACRO_KEYS } from "./draft";
import { sameRange } from "./totals";

const sameItem = (a: MealItem, b: MealItem) =>
  a.name === b.name && sameRange(a.grams, b.grams) && sameRange(a.kcal, b.kcal);

/**
 * Body de `PATCH /meals/:id`: solo los campos que cambiaron, cada uno completo como lo pide la API
 * (`items` es la lista entera; `macros`, los tres rangos aunque cambie uno). `null` si no cambió
 * nada. El historial de `corrections` lo arma el Backend.
 */
export function buildCorrection(meal: MealValues, values: MealValues): MealCorrection | null {
  const body: MealCorrection = {};
  if (values.dish !== meal.dish) body.dish = values.dish;
  const sameItems =
    values.items.length === meal.items.length &&
    values.items.every((item, index) => sameItem(item, meal.items[index]));
  if (!sameItems) body.items = values.items;
  if (!sameRange(values.kcal, meal.kcal)) body.kcal = values.kcal;
  if (!MACRO_KEYS.every((macro) => sameRange(values.macros[macro], meal.macros[macro]))) {
    body.macros = values.macros;
  }
  return Object.keys(body).length > 0 ? body : null;
}

export function keepPhoto(shown: Meal, updated: ReadyMeal): ReadyMeal {
  return { ...updated, photoUrl: shown.photoUrl };
}

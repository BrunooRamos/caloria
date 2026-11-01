import { isDeepStrictEqual } from "node:util";
import type { CorrectableFields, Range } from "@caloria/shared";
import { applyCorrections } from "./meal-corrections";
import type { SimilarMeal } from "./similar-meals";

// Rótulo y etiquetas del bloque de contexto: el prompt de sistema los nombra.
export const SIMILAR_MEALS_LABEL = "Comidas parecidas que corrigió el usuario:";
export const SIMILAR_MEALS_OPEN = "<comidas_corregidas>";
export const SIMILAR_MEALS_CLOSE = "</comidas_corregidas>";
// Ingredientes por comida: alcanza para reconocer el plato sin inflar el prompt.
const ITEMS_PER_MEAL = 12;

type Item = CorrectableFields["items"][number];
/** Un valor exacto (`min = max`, como los que escribe la persona) va como número solo. */
type Value = number | [number, number];

const value = ({ min, max }: Range): Value => (min === max ? min : [min, max]);
const amounts = (item: Item) => ({ g: value(item.grams), kcal: value(item.kcal) });
const item = (entry: Item) => ({ nombre: entry.name, ...amounts(entry) });
const macros = ({ protein, carbs, fat }: CorrectableFields["macros"]) => ({
  proteina: value(protein),
  carbohidratos: value(carbs),
  grasas: value(fat),
});

/** Qué ingredientes quitó, agregó o cambió la persona, comparando por nombre. */
function itemChanges(before: Item[], after: Item[]) {
  const key = (entry: Item) => entry.name.trim().toLowerCase();
  const beforeByName = new Map(before.map((entry) => [key(entry), entry]));
  const afterNames = new Set(after.map(key));
  const removed = before.filter((entry) => !afterNames.has(key(entry))).map(({ name }) => name);
  const added = after.filter((entry) => !beforeByName.has(key(entry))).map(item);
  const changed = after.flatMap((entry) => {
    const previous = beforeByName.get(key(entry));
    if (!previous || isDeepStrictEqual(amounts(previous), amounts(entry))) return [];
    return [{ nombre: entry.name, antes: amounts(previous), despues: amounts(entry) }];
  });
  return {
    ...(removed.length > 0 && { quitados: removed }),
    ...(added.length > 0 && { agregados: added }),
    ...(changed.length > 0 && { cambiados: changed }),
  };
}

/** Por cada campo corregido, lo que dijo la IA (`antes`) y el valor final (`despues`). */
function changes(meal: SimilarMeal, final: CorrectableFields) {
  const { analysis } = meal;
  const corrected = new Set(meal.corrections.map(({ field }) => field));
  const out: Record<string, unknown>[] = [];
  if (corrected.has("dish") && analysis.dish !== final.dish) {
    out.push({ campo: "plato", antes: analysis.dish, despues: final.dish });
  }
  if (corrected.has("items")) {
    const diff = itemChanges(analysis.items, final.items);
    if (Object.keys(diff).length > 0) out.push({ campo: "ingredientes", ...diff });
  }
  if (corrected.has("kcal") && !isDeepStrictEqual(value(analysis.kcal), value(final.kcal))) {
    out.push({ campo: "kcal", antes: value(analysis.kcal), despues: value(final.kcal) });
  }
  if (
    corrected.has("macros") &&
    !isDeepStrictEqual(macros(analysis.macros), macros(final.macros))
  ) {
    out.push({ campo: "macros", antes: macros(analysis.macros), despues: macros(final.macros) });
  }
  return out;
}

/**
 * Bloque de contexto para la IA: una comida por línea en JSON, la más parecida primero, con el plato,
 * los valores finales y lo que se corrigió. Los nombres los escribió la persona: van escapados en
 * JSON y sin `<` ni `>` crudos, así ningún nombre puede cerrar el bloque.
 */
export function formatSimilarMeals(meals: readonly SimilarMeal[]): string {
  const lines = meals.map((meal) => {
    const final = applyCorrections(meal.analysis, meal.corrections);
    const entry = {
      plato: final.dish,
      kcal: value(final.kcal),
      macros: macros(final.macros),
      ingredientes: final.items.slice(0, ITEMS_PER_MEAL).map(item),
      correcciones: changes(meal, final),
    };
    return JSON.stringify(entry).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  });
  return [SIMILAR_MEALS_LABEL, SIMILAR_MEALS_OPEN, ...lines, SIMILAR_MEALS_CLOSE].join("\n");
}

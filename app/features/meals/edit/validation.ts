import type { MealItem, MealValues, Range } from "@/services/meals";
import { MACRO_KEYS, nameKey, rangeKey } from "./draft";
import type { MealDraft, RangePath } from "./draft";
import { formatRangeInput, parseRange } from "./parse-range";
import { totalKcal } from "./totals";
import type { TotalKcal } from "./totals";

// Los mismos topes que `correctMealSchema` en shared: lo que pasa acá no rebota en la API.
export const DISH_MAX_CHARS = 200;
export const ITEM_NAME_MAX_CHARS = 100;
export const ITEMS_MAX = 50;

/** Errores por campo, con las claves de `errorKey` y `nameKey`; `items` es el de la lista. */
export type EditErrors = Partial<Record<string, string>>;

export interface DraftCheck {
  /** Lo que se guardaría, o `null` si hay errores. */
  values: MealValues | null;
  errors: EditErrors;
  /** El total sin contar el que escribió la persona: el placeholder y la ayuda del campo. */
  autoTotal: TotalKcal;
}

/** El error de un campo vacío, según qué falta. */
export const MISSING = {
  grams: "Ingresá los gramos.",
  kcal: "Ingresá las kcal.",
  total: "Ingresá las calorías totales.",
  macro: "Ingresá los gramos.",
};

interface ResolvedRange {
  range?: Range;
  errors: EditErrors;
}

export function resolveRange(
  text: string,
  current: Range | undefined,
  path: RangePath,
  missing: string,
): ResolvedRange {
  if (current && text.trim() === formatRangeInput(current)) {
    return { range: { min: current.min, max: current.max }, errors: {} };
  }
  const parsed = parseRange(text, missing);
  if ("error" in parsed) return { errors: { [rangeKey(path)]: parsed.error } };
  return { range: parsed.range, errors: {} };
}

function checkName(name: string, max: number, empty: string): string | undefined {
  const value = name.trim();
  if (!value) return empty;
  if (value.length > max) return `Usá hasta ${max} caracteres.`;
  return undefined;
}

/**
 * Valida el borrador contra la comida como estaba y arma los valores finales, con el total según
 * `totalKcal`. Los ingredientes quitados no cuentan.
 */
export function checkDraft(meal: MealValues, draft: MealDraft): DraftCheck {
  const errors: EditErrors = {};
  const collect = ({ range, errors: found }: ResolvedRange) => {
    Object.assign(errors, found);
    return range;
  };

  const dishError = checkName(draft.dish, DISH_MAX_CHARS, "Ingresá el nombre del plato.");
  if (dishError) errors.dish = dishError;

  const active = draft.items.filter((item) => !item.removed);
  if (active.length > ITEMS_MAX) errors.items = `Podés guardar hasta ${ITEMS_MAX} ingredientes.`;
  const items = active.map(({ key, original, name, grams, kcal }) => {
    const nameError = checkName(name, ITEM_NAME_MAX_CHARS, "Ingresá el nombre del ingrediente.");
    if (nameError) errors[nameKey(key)] = nameError;
    return {
      name: name.trim(),
      grams: collect(
        resolveRange(grams, original?.grams, { field: "items", key, part: "grams" }, MISSING.grams),
      ),
      kcal: collect(
        resolveRange(kcal, original?.kcal, { field: "items", key, part: "kcal" }, MISSING.kcal),
      ),
    };
  });

  const autoTotal = totalKcal(
    meal,
    items.map((item) => item.kcal),
  );
  // Escrito a mano, el total que arrancó en el campo es el automático de ese momento.
  const kcal =
    draft.kcal === null
      ? autoTotal.kcal
      : collect(resolveRange(draft.kcal, autoTotal.kcal, { field: "kcal" }, MISSING.total));

  const macros = Object.fromEntries(
    MACRO_KEYS.map((macro) => [
      macro,
      collect(
        resolveRange(
          draft.macros[macro],
          meal.macros[macro],
          { field: "macros", macro },
          MISSING.macro,
        ),
      ),
    ]),
  );

  if (Object.keys(errors).length > 0 || !kcal) return { values: null, errors, autoTotal };
  return {
    values: {
      dish: draft.dish.trim(),
      items: items as MealItem[],
      kcal,
      macros: macros as MealValues["macros"],
    },
    errors,
    autoTotal,
  };
}

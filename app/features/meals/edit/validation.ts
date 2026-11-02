import type { MealItem, MealValues, Range } from "@/services/meals";
import { MACRO_KEYS, errorKey, isManual, nameKey } from "./draft";
import type { MealDraft, RangeDraft, RangePath } from "./draft";
import { totalKcal } from "./totals";
import type { TotalKcal } from "./totals";

// Los mismos topes que `correctMealSchema` en shared: lo que pasa acá no rebota en la API.
export const DISH_MAX_CHARS = 200;
export const ITEM_NAME_MAX_CHARS = 100;
export const ITEMS_MAX = 50;
/** Hasta 99 999: ninguna comida llega y el campo no deja escribir más. */
export const VALUE_MAX_DIGITS = 5;

/** Errores por campo, con las claves de `errorKey` y `nameKey`; `items` es el de la lista. */
export type EditErrors = Partial<Record<string, string>>;

export interface DraftCheck {
  /** Lo que se guardaría, o `null` si hay errores. */
  values: MealValues | null;
  errors: EditErrors;
  /** El total sin contar el que escribió la persona: el placeholder y la ayuda del campo. */
  autoTotal: TotalKcal;
}

const MISSING = {
  grams: "Ingresá los gramos.",
  kcal: "Ingresá las kcal.",
};

/** Un entero no negativo, o el mensaje de por qué no lo es. */
export function parseCount(text: string): number | string {
  const value = text.trim();
  if (/^-\s*\d/.test(value)) return "No puede ser negativo.";
  if (!/^\d+$/.test(value)) return "Usá un número entero, sin comas ni puntos.";
  return Number(value);
}

interface ResolvedRange {
  range?: Range;
  errors: EditErrors;
}

/**
 * El rango que queda de un `RangeDraft`. Un solo valor vacío deja `current` (o es un error si no
 * hay, como en un ingrediente nuevo); un número es `{ min: n, max: n }`.
 */
export function resolveRange(
  draft: RangeDraft,
  current: Range | undefined,
  path: RangePath,
  missing = "Ingresá un valor.",
): ResolvedRange {
  if (draft.mode === "single") {
    if (draft.value.trim() === "") {
      if (current) return { range: { min: current.min, max: current.max }, errors: {} };
      return { errors: { [errorKey(path, "value")]: missing } };
    }
    const value = parseCount(draft.value);
    if (typeof value === "string") return { errors: { [errorKey(path, "value")]: value } };
    return { range: { min: value, max: value }, errors: {} };
  }

  const min = draft.min.trim() === "" ? "Ingresá el mínimo." : parseCount(draft.min);
  const max = draft.max.trim() === "" ? "Ingresá el máximo." : parseCount(draft.max);
  const errors: EditErrors = {};
  if (typeof min === "string") errors[errorKey(path, "min")] = min;
  if (typeof max === "string") errors[errorKey(path, "max")] = max;
  if (typeof min === "string" || typeof max === "string") return { errors };
  if (min > max)
    return { errors: { [errorKey(path, "max")]: "No puede ser menor que el mínimo." } };
  return { range: { min, max }, errors: {} };
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
  const kcal = isManual(draft.kcal)
    ? collect(resolveRange(draft.kcal, undefined, { field: "kcal" }))
    : autoTotal.kcal;

  const macros = Object.fromEntries(
    MACRO_KEYS.map((macro) => [
      macro,
      collect(resolveRange(draft.macros[macro], meal.macros[macro], { field: "macros", macro })),
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

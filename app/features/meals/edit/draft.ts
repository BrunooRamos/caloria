import type { MealItem, MealValues, Range } from "@/services/meals";

export const MACRO_KEYS = ["protein", "carbs", "fat"] as const;
export type MacroKey = (typeof MACRO_KEYS)[number];

/**
 * Lo que la persona escribe para un valor `{ min, max }`. En `single`, `value` vacío deja el valor
 * que había y un número es un valor exacto (`min` igual a `max`). En `range` edita los dos extremos.
 */
export interface RangeDraft {
  mode: "single" | "range";
  value: string;
  min: string;
  max: string;
}

export interface ItemDraft {
  /** Estable mientras se edita: identifica al ingrediente en la lista y en los errores. */
  key: string;
  /** El ingrediente como estaba; falta en uno que agregó la persona. */
  original?: MealItem;
  name: string;
  grams: RangeDraft;
  kcal: RangeDraft;
  /** Quitado, con la opción de deshacerlo mientras no se guarde. */
  removed: boolean;
}

export interface MealDraft {
  dish: string;
  items: ItemDraft[];
  /** El total. Vacío es automático: ver `totalKcal`. */
  kcal: RangeDraft;
  macros: Record<MacroKey, RangeDraft>;
}

/** Dónde está un valor del borrador; también arma las claves de sus errores. */
export type RangePath =
  | { field: "kcal" }
  | { field: "macros"; macro: MacroKey }
  | { field: "items"; key: string; part: "grams" | "kcal" };

export type RangeInput = "value" | "min" | "max";

export const EMPTY_RANGE: RangeDraft = { mode: "single", value: "", min: "", max: "" };

/** Un valor exacto arranca escrito; un rango arranca vacío y se ve como placeholder. */
export function rangeDraft({ min, max }: Range): RangeDraft {
  return {
    mode: "single",
    value: min === max ? String(min) : "",
    min: String(min),
    max: String(max),
  };
}

export function createDraft(meal: MealValues): MealDraft {
  return {
    dish: meal.dish,
    items: meal.items.map((item, index) => ({
      key: `item-${index}`,
      original: item,
      name: item.name,
      grams: rangeDraft(item.grams),
      kcal: rangeDraft(item.kcal),
      removed: false,
    })),
    // El total nunca arranca escrito: así se distingue el que puso la persona del calculado.
    kcal: EMPTY_RANGE,
    macros: {
      protein: rangeDraft(meal.macros.protein),
      carbs: rangeDraft(meal.macros.carbs),
      fat: rangeDraft(meal.macros.fat),
    },
  };
}

export function newItem(key: string): ItemDraft {
  return { key, name: "", grams: EMPTY_RANGE, kcal: EMPTY_RANGE, removed: false };
}

/** El total lo escribió la persona: un número o un rango. Vacío vuelve a ser automático. */
export function isManual(draft: RangeDraft): boolean {
  return draft.mode === "range" || draft.value.trim() !== "";
}

/**
 * Pasa a editar mínimo y máximo: con el número que haya escrito, con el rango que ya había cargado
 * o, si no hay nada, con `current`.
 */
export function toRangeMode(draft: RangeDraft, current?: Range): RangeDraft {
  const value = draft.value.trim();
  if (value) return { ...draft, mode: "range", min: value, max: value };
  if (draft.min || draft.max || !current) return { ...draft, mode: "range" };
  return { ...draft, mode: "range", min: String(current.min), max: String(current.max) };
}

/** Vuelve a un solo valor: si mínimo y máximo coinciden queda ese número; si no, vacío. */
export function toSingleMode(draft: RangeDraft): RangeDraft {
  const min = draft.min.trim();
  return { ...draft, mode: "single", value: min !== "" && min === draft.max.trim() ? min : "" };
}

export function rangeKey(path: RangePath): string {
  if (path.field === "kcal") return "kcal";
  if (path.field === "macros") return `macros.${path.macro}`;
  return `items.${path.key}.${path.part}`;
}

export const errorKey = (path: RangePath, input: RangeInput) => `${rangeKey(path)}.${input}`;
export const nameKey = (key: string) => `items.${key}.name`;

export function getRange(draft: MealDraft, path: RangePath): RangeDraft | undefined {
  if (path.field === "kcal") return draft.kcal;
  if (path.field === "macros") return draft.macros[path.macro];
  return draft.items.find((item) => item.key === path.key)?.[path.part];
}

export function setRange(draft: MealDraft, path: RangePath, next: RangeDraft): MealDraft {
  if (path.field === "kcal") return { ...draft, kcal: next };
  if (path.field === "macros") return { ...draft, macros: { ...draft.macros, [path.macro]: next } };
  return updateItem(draft, path.key, (item) => ({ ...item, [path.part]: next }));
}

export function updateItem(
  draft: MealDraft,
  key: string,
  update: (item: ItemDraft) => ItemDraft,
): MealDraft {
  return { ...draft, items: draft.items.map((item) => (item.key === key ? update(item) : item)) };
}

/** Un ingrediente nuevo sin nada escrito se descarta; cualquier otro queda para deshacer. */
export function removeItem(draft: MealDraft, key: string): MealDraft {
  const item = draft.items.find((candidate) => candidate.key === key);
  if (item && !item.original && isBlank(item)) {
    return { ...draft, items: draft.items.filter((candidate) => candidate.key !== key) };
  }
  return updateItem(draft, key, (current) => ({ ...current, removed: true }));
}

function isBlank({ name, grams, kcal }: ItemDraft): boolean {
  return [name, grams.value, grams.min, grams.max, kcal.value, kcal.min, kcal.max].every(
    (text) => text.trim() === "",
  );
}

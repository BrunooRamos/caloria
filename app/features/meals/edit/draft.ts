import type { MealItem, MealValues } from "@/services/meals";
import { formatRangeInput } from "./parse-range";

export const MACRO_KEYS = ["protein", "carbs", "fat"] as const;
export type MacroKey = (typeof MACRO_KEYS)[number];

export interface ItemDraft {
  /** Estable mientras se edita: identifica al ingrediente en la lista y en los errores. */
  key: string;
  /** El ingrediente como estaba; falta en uno que agregó la persona. */
  original?: MealItem;
  name: string;
  grams: string;
  kcal: string;
  /** Quitado, con la opción de deshacerlo mientras no se guarde. */
  removed: boolean;
}

export interface MealDraft {
  dish: string;
  items: ItemDraft[];
  kcal: string | null;
  macros: Record<MacroKey, string>;
}

/** Dónde está un valor del borrador; también arma la clave de su error. */
export type RangePath =
  | { field: "kcal" }
  | { field: "macros"; macro: MacroKey }
  | { field: "items"; key: string; part: "grams" | "kcal" };

/** Todos los valores arrancan escritos con lo que había; el total, automático. */
export function createDraft(meal: MealValues): MealDraft {
  return {
    dish: meal.dish,
    items: meal.items.map((item, index) => ({
      key: `item-${index}`,
      original: item,
      name: item.name,
      grams: formatRangeInput(item.grams),
      kcal: formatRangeInput(item.kcal),
      removed: false,
    })),
    kcal: null,
    macros: {
      protein: formatRangeInput(meal.macros.protein),
      carbs: formatRangeInput(meal.macros.carbs),
      fat: formatRangeInput(meal.macros.fat),
    },
  };
}

export function newItem(key: string): ItemDraft {
  return { key, name: "", grams: "", kcal: "", removed: false };
}

/** El total lo escribió la persona; si no, se calcula solo. */
export function isManual(draft: MealDraft): boolean {
  return draft.kcal !== null;
}

/** La clave del error de un valor. */
export function rangeKey(path: RangePath): string {
  if (path.field === "kcal") return "kcal";
  if (path.field === "macros") return `macros.${path.macro}`;
  return `items.${path.key}.${path.part}`;
}

export const nameKey = (key: string) => `items.${key}.name`;

export function setRange(draft: MealDraft, path: RangePath, text: string): MealDraft {
  if (path.field === "kcal") return { ...draft, kcal: text };
  if (path.field === "macros") return { ...draft, macros: { ...draft.macros, [path.macro]: text } };
  return updateItem(draft, path.key, (item) => ({ ...item, [path.part]: text }));
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
  return [name, grams, kcal].every((text) => text.trim() === "");
}

import { useRef, useState } from "react";
import { errorMessage } from "@/services/error-messages";
import type { MealCorrection, MealValues } from "@/services/meals";
import { buildCorrection } from "./correction";
import { createDraft, nameKey, newItem, rangeKey, removeItem, setRange, updateItem } from "./draft";
import type { MealDraft, RangePath } from "./draft";
import { checkDraft } from "./validation";
import type { EditErrors } from "./validation";

/**
 * Estado de la corrección de una comida. Los errores se muestran como en auth: al salir del campo
 * o al guardar, y se van apenas se corrigen. `meal` es la comida al abrir la pantalla.
 */
export function useMealEditor(meal: MealValues, onSave: (body: MealCorrection) => Promise<void>) {
  const [draft, setDraft] = useState<MealDraft>(() => createDraft(meal));
  const [shown, setShown] = useState<EditErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const added = useRef(0);

  const check = checkDraft(meal, draft);
  const body = check.values ? buildCorrection(meal, check.values) : null;
  // Algo inválido también es un cambio: la comida como estaba siempre es válida.
  const changed = !check.values || body !== null;

  function update(next: MealDraft) {
    setDraft(next);
    const { errors } = checkDraft(meal, next);
    setShown((current) => {
      const kept: EditErrors = {};
      for (const key of Object.keys(current)) if (errors[key]) kept[key] = errors[key];
      return kept;
    });
  }

  /** Muestra los errores de esas claves que sigan sin resolverse. */
  function reveal(keys: string[]) {
    setShown((current) => {
      const next = { ...current };
      for (const key of keys) next[key] = check.errors[key];
      return next;
    });
  }

  async function save() {
    if (inFlight.current) return;
    if (!check.values) {
      setShown(check.errors);
      setFormError(null);
      return;
    }
    if (!body) return;
    inFlight.current = true;
    setSaving(true);
    setFormError(null);
    try {
      await onSave(body);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return {
    draft,
    changed,
    saving,
    formError,
    autoTotal: check.autoTotal,
    errors: shown,
    save: () => void save(),
    setDish(dish: string) {
      update({ ...draft, dish });
    },
    blurDish: () => reveal(["dish"]),
    setItemName(key: string, name: string) {
      update(updateItem(draft, key, (item) => ({ ...item, name })));
    },
    blurItemName: (key: string) => reveal([nameKey(key)]),
    setRange(path: RangePath, text: string) {
      update(setRange(draft, path, text));
    },
    blurRange: (path: RangePath) => reveal([rangeKey(path)]),
    /** El total vuelve a calcularse solo. */
    resetTotal() {
      update({ ...draft, kcal: null });
    },
    addItem() {
      added.current += 1;
      update({ ...draft, items: [...draft.items, newItem(`new-${added.current}`)] });
    },
    removeItem(key: string) {
      update(removeItem(draft, key));
    },
    undoRemove(key: string) {
      update(updateItem(draft, key, (item) => ({ ...item, removed: false })));
    },
  };
}

export type MealEditor = ReturnType<typeof useMealEditor>;

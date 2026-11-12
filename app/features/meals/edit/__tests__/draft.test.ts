import { meal } from "@/test-utils/meals";
import { createDraft, isManual, newItem, removeItem, setRange } from "../draft";

describe("createDraft", () => {
  it("cada valor arranca escrito: un número si min y max coinciden y si no el rango", () => {
    const draft = createDraft(meal);
    expect(draft.items[0].grams).toBe("150-190");
    expect(draft.items[0].kcal).toBe("380-470");
    expect(draft.items[1].grams).toBe("200");
    expect(draft.macros).toEqual({ protein: "38-46", carbs: "50-65", fat: "28-38" });
  });

  it("el total arranca automático y escribirlo lo vuelve manual", () => {
    const draft = createDraft(meal);
    expect(draft.kcal).toBeNull();
    expect(isManual(draft)).toBe(false);
    expect(isManual(setRange(draft, { field: "kcal" }, ""))).toBe(true);
  });
});

describe("removeItem", () => {
  it("un ingrediente que estaba queda quitado, para poder deshacerlo", () => {
    const draft = createDraft(meal);
    const next = removeItem(draft, draft.items[0].key);
    expect(next.items).toHaveLength(2);
    expect(next.items[0].removed).toBe(true);
  });

  it("uno nuevo sin nada escrito se descarta; con algo escrito, queda para deshacer", () => {
    const draft = createDraft(meal);
    const blank = { ...draft, items: [...draft.items, newItem("n1")] };
    expect(removeItem(blank, "n1").items).toHaveLength(2);

    const named = { ...draft, items: [...draft.items, { ...newItem("n1"), grams: "80" }] };
    expect(removeItem(named, "n1").items[2].removed).toBe(true);
  });
});

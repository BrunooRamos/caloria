import { meal } from "@/test-utils/meals";
import { createDraft, isManual, newItem, removeItem, toRangeMode, toSingleMode } from "../draft";
import type { RangeDraft } from "../draft";

describe("createDraft", () => {
  it("un valor exacto arranca escrito y un rango arranca vacío; el total, siempre vacío", () => {
    const draft = createDraft(meal);
    expect(draft.items[0].grams).toEqual({ mode: "single", value: "", min: "150", max: "190" });
    expect(draft.items[1].grams).toEqual({ mode: "single", value: "200", min: "200", max: "200" });
    expect(draft.kcal.value).toBe("");
    expect(isManual(draft.kcal)).toBe(false);
  });
});

describe("cambiar entre un valor y un rango", () => {
  const empty: RangeDraft = { mode: "single", value: "", min: "", max: "" };

  it("a rango: con el número escrito en los dos extremos", () => {
    expect(toRangeMode({ ...empty, value: "170" })).toMatchObject({
      mode: "range",
      min: "170",
      max: "170",
    });
  });

  it("a rango sin nada escrito: con el que ya tenía cargado o, si no, con el actual", () => {
    expect(toRangeMode({ ...empty, min: "150", max: "190" }, { min: 1, max: 2 })).toMatchObject({
      min: "150",
      max: "190",
    });
    expect(toRangeMode(empty, { min: 620, max: 780 })).toMatchObject({ min: "620", max: "780" });
  });

  it("a un valor: el número si min y max coinciden; si no, vacío", () => {
    expect(toSingleMode({ mode: "range", value: "", min: "200", max: "200" }).value).toBe("200");
    expect(toSingleMode({ mode: "range", value: "", min: "150", max: "190" }).value).toBe("");
  });

  it("un total en rango o con un número es manual", () => {
    expect(isManual({ ...empty, value: "700" })).toBe(true);
    expect(isManual({ ...empty, mode: "range" })).toBe(true);
    expect(isManual({ ...empty, value: "  " })).toBe(false);
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

    const named = { ...draft, items: [...draft.items, { ...newItem("n1"), name: "Ensalada" }] };
    expect(removeItem(named, "n1").items[2].removed).toBe(true);
  });
});

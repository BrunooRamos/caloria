import { meal } from "@/test-utils/meals";
import { buildCorrection } from "../correction";
import { createDraft, newItem, setRange, updateItem } from "../draft";
import type { MealDraft } from "../draft";
import { RANGE_ERRORS } from "../parse-range";
import { ITEMS_MAX, checkDraft, resolveRange } from "../validation";

const total = { field: "kcal" } as const;
const first = (draft: MealDraft) => draft.items[0].key;

describe("resolveRange", () => {
  const current = { min: 150, max: 190 };

  it("un número es un valor exacto y un rango, el rango", () => {
    expect(resolveRange("170", current, total, "")).toEqual({
      range: { min: 170, max: 170 },
      errors: {},
    });
    expect(resolveRange("100 a 120", current, total, "")).toEqual({
      range: { min: 100, max: 120 },
      errors: {},
    });
  });

  it("el texto como arrancó deja el valor exacto que había, aunque se vea redondeado", () => {
    const precise = { min: 37.6, max: 46.2 };
    expect(resolveRange(" 38-46 ", precise, total, "")).toEqual({ range: precise, errors: {} });
  });

  it("vacío o inválido es un error en el campo", () => {
    expect(resolveRange(" ", current, total, "Ingresá los gramos.")).toEqual({
      errors: { kcal: "Ingresá los gramos." },
    });
    expect(resolveRange("-5", current, total, "").errors).toEqual({
      kcal: RANGE_ERRORS.negative,
    });
  });
});

describe("checkDraft", () => {
  it("sin tocar nada, los valores son los que había y no hay nada para mandar", () => {
    const { values, errors } = checkDraft(meal, createDraft(meal));
    expect(errors).toEqual({});
    expect(values).toEqual(meal);
    expect(buildCorrection(meal, values!)).toBeNull();
  });

  it("el plato y los ingredientes no pueden quedar vacíos", () => {
    const draft = createDraft(meal);
    const result = checkDraft(meal, {
      ...updateItem(draft, first(draft), (item) => ({ ...item, name: "   " })),
      dish: "",
    });
    expect(result.values).toBeNull();
    expect(result.errors).toEqual({
      dish: "Ingresá el nombre del plato.",
      [`items.${first(draft)}.name`]: "Ingresá el nombre del ingrediente.",
    });
  });

  it("respeta los topes de la API", () => {
    const draft = createDraft(meal);
    const longName = updateItem(draft, first(draft), (item) => ({
      ...item,
      name: "a".repeat(101),
    }));
    expect(checkDraft(meal, { ...longName, dish: "b".repeat(201) }).errors).toEqual({
      dish: "Usá hasta 200 caracteres.",
      [`items.${first(draft)}.name`]: "Usá hasta 100 caracteres.",
    });

    const many = {
      ...draft,
      items: Array.from({ length: ITEMS_MAX + 1 }, (_, i) => newItem(`n${i}`)),
    };
    expect(checkDraft(meal, many).errors.items).toBe("Podés guardar hasta 50 ingredientes.");
  });

  it("los nombres se guardan sin espacios de más", () => {
    const draft = createDraft(meal);
    const { values } = checkDraft(meal, {
      ...updateItem(draft, first(draft), (item) => ({ ...item, name: "  Milanesa de pollo " })),
      dish: " Milanesa con puré  ",
    });
    expect(values?.dish).toBe("Milanesa con puré");
    expect(values?.items[0].name).toBe("Milanesa de pollo");
  });

  it("un ingrediente nuevo necesita nombre, gramos y kcal", () => {
    const draft = createDraft(meal);
    const result = checkDraft(meal, { ...draft, items: [...draft.items, newItem("n1")] });
    expect(result.errors).toEqual({
      "items.n1.name": "Ingresá el nombre del ingrediente.",
      "items.n1.grams": "Ingresá los gramos.",
      "items.n1.kcal": "Ingresá las kcal.",
    });
  });

  it("un ingrediente quitado no se valida ni se guarda", () => {
    const draft = createDraft(meal);
    const removed = updateItem(draft, first(draft), (item) => ({
      ...item,
      name: "",
      removed: true,
    }));
    const { values, errors } = checkDraft(meal, removed);
    expect(errors).toEqual({});
    expect(values?.items).toEqual([meal.items[1]]);
    // Sin la milanesa, el total es la suma de lo que queda.
    expect(values?.kcal).toEqual(meal.items[1].kcal);
  });

  it("con un ingrediente cambiado y el total sin tocar, guarda la suma", () => {
    const draft = createDraft(meal);
    const edited = updateItem(draft, first(draft), (item) => ({ ...item, kcal: "420" }));
    const { values, autoTotal } = checkDraft(meal, edited);
    expect(autoTotal).toEqual({ kcal: { min: 600, max: 650 }, source: "sum" });
    expect(values?.kcal).toEqual({ min: 600, max: 650 });
  });

  it("el total escrito a mano gana sobre la suma", () => {
    const draft = createDraft(meal);
    const edited = updateItem(draft, first(draft), (item) => ({ ...item, kcal: "420" }));
    expect(checkDraft(meal, { ...edited, kcal: "900" }).values?.kcal).toEqual({
      min: 900,
      max: 900,
    });
    expect(checkDraft(meal, { ...edited, kcal: "950-850" }).values?.kcal).toEqual({
      min: 850,
      max: 950,
    });
  });

  it("un total vacío o inválido es un error en el campo y no deja guardar", () => {
    const empty = checkDraft(meal, setRange(createDraft(meal), total, ""));
    expect(empty.values).toBeNull();
    expect(empty.errors).toEqual({ kcal: "Ingresá las calorías totales." });
    expect(checkDraft(meal, setRange(createDraft(meal), total, "900-")).errors).toEqual({
      kcal: RANGE_ERRORS.invalid,
    });
  });

  it("escribir el mismo total que ya mostraba no es un cambio", () => {
    const { values } = checkDraft(meal, setRange(createDraft(meal), total, "620-780"));
    expect(buildCorrection(meal, values!)).toBeNull();
  });

  it("un macro acepta un número o un rango; vacío no deja guardar", () => {
    const protein = { field: "macros", macro: "protein" } as const;
    const fat = { field: "macros", macro: "fat" } as const;
    const { values } = checkDraft(meal, setRange(createDraft(meal), protein, "40"));
    expect(values?.macros).toEqual({ ...meal.macros, protein: { min: 40, max: 40 } });
    expect(
      checkDraft(meal, setRange(createDraft(meal), fat, "35 a 30")).values?.macros.fat,
    ).toEqual({ min: 30, max: 35 });

    const empty = checkDraft(meal, setRange(createDraft(meal), protein, ""));
    expect(empty.values).toBeNull();
    expect(empty.errors).toEqual({ "macros.protein": "Ingresá los gramos." });
  });
});

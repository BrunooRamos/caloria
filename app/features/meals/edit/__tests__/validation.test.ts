import { meal } from "@/test-utils/meals";
import { buildCorrection } from "../correction";
import { EMPTY_RANGE, createDraft, newItem, updateItem } from "../draft";
import type { MealDraft, RangeDraft } from "../draft";
import { ITEMS_MAX, checkDraft, parseCount, resolveRange } from "../validation";

const single = (value: string): RangeDraft => ({ ...EMPTY_RANGE, value });
const range = (min: string, max: string): RangeDraft => ({ mode: "range", value: "", min, max });
const total = { field: "kcal" } as const;
const first = (draft: MealDraft) => draft.items[0].key;

describe("parseCount", () => {
  it("acepta enteros, con espacios alrededor", () => {
    expect(parseCount("12")).toBe(12);
    expect(parseCount(" 7 ")).toBe(7);
    expect(parseCount("0")).toBe(0);
  });

  it("un negativo dice que no puede serlo", () => {
    expect(parseCount("-3")).toBe("No puede ser negativo.");
  });

  it.each(["1.5", "1,5", "abc", "1e3", "12 g"])("%s no es un entero", (text) => {
    expect(parseCount(text)).toBe("Usá un número entero, sin comas ni puntos.");
  });
});

describe("resolveRange", () => {
  const current = { min: 150, max: 190 };

  it("un solo valor vacío deja el que había", () => {
    expect(resolveRange(single(""), current, total)).toEqual({ range: current, errors: {} });
  });

  it("un solo valor vacío sin uno anterior es un error en el campo", () => {
    expect(resolveRange(single(" "), undefined, total, "Ingresá los gramos.")).toEqual({
      errors: { "kcal.value": "Ingresá los gramos." },
    });
  });

  it("un número es un valor exacto: min igual a max", () => {
    expect(resolveRange(single("170"), current, total)).toEqual({
      range: { min: 170, max: 170 },
      errors: {},
    });
  });

  it("un valor inválido marca el campo", () => {
    expect(resolveRange(single("-5"), current, total).errors).toEqual({
      "kcal.value": "No puede ser negativo.",
    });
  });

  it("un rango con mínimo y máximo", () => {
    expect(resolveRange(range("100", "120"), current, total)).toEqual({
      range: { min: 100, max: 120 },
      errors: {},
    });
    expect(resolveRange(range("100", "100"), current, total).range).toEqual({ min: 100, max: 100 });
  });

  it("el mínimo no puede pasar al máximo: el error va en el máximo", () => {
    expect(resolveRange(range("200", "150"), current, total)).toEqual({
      errors: { "kcal.max": "No puede ser menor que el mínimo." },
    });
  });

  it("en un rango, los dos extremos son obligatorios", () => {
    expect(resolveRange(range("", "abc"), current, total).errors).toEqual({
      "kcal.min": "Ingresá el mínimo.",
      "kcal.max": "Usá un número entero, sin comas ni puntos.",
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
      "items.n1.grams.value": "Ingresá los gramos.",
      "items.n1.kcal.value": "Ingresá las kcal.",
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
    const edited = updateItem(draft, first(draft), (item) => ({ ...item, kcal: single("420") }));
    const { values, autoTotal } = checkDraft(meal, edited);
    expect(autoTotal).toEqual({ kcal: { min: 600, max: 650 }, source: "sum" });
    expect(values?.kcal).toEqual({ min: 600, max: 650 });
  });

  it("el total escrito a mano gana sobre la suma", () => {
    const draft = createDraft(meal);
    const edited = updateItem(draft, first(draft), (item) => ({ ...item, kcal: single("420") }));
    expect(checkDraft(meal, { ...edited, kcal: single("900") }).values?.kcal).toEqual({
      min: 900,
      max: 900,
    });
    expect(checkDraft(meal, { ...edited, kcal: range("850", "950") }).values?.kcal).toEqual({
      min: 850,
      max: 950,
    });
  });

  it("un total inválido es un error en el campo", () => {
    const result = checkDraft(meal, { ...createDraft(meal), kcal: range("900", "800") });
    expect(result.values).toBeNull();
    expect(result.errors).toEqual({ "kcal.max": "No puede ser menor que el mínimo." });
  });

  it("los macros se editan a mano y vacíos quedan como estaban", () => {
    const draft = createDraft(meal);
    const { values } = checkDraft(meal, {
      ...draft,
      macros: { ...draft.macros, protein: single("40") },
    });
    expect(values?.macros).toEqual({ ...meal.macros, protein: { min: 40, max: 40 } });
  });
});

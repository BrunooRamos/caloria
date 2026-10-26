import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import type { MealAnalysis } from "../src/models/Meal";
import { applyCorrections } from "../src/services/meal-corrections";
import { toMealResponse } from "../src/services/meal-response";
import type { MealResponseSource } from "../src/services/meal-response";

const AT = new Date("2026-10-06T13:05:00Z");
const PHOTO_URL = "https://media.example/firmada";

const analysis: MealAnalysis = {
  dish: "Milanesa con puré",
  items: [{ name: "Milanesa", grams: { min: 150, max: 190 }, kcal: { min: 380, max: 470 } }],
  kcal: { min: 620, max: 780 },
  macros: {
    protein: { min: 38, max: 46 },
    carbs: { min: 50, max: 65 },
    fat: { min: 28, max: 38 },
  },
  confidence: 0.72,
  promptVersion: "1.0.0",
  model: "gpt-6-luna",
};

const correction = (field: string, to: unknown) => ({ field, from: null, to, at: AT });

describe("applyCorrections", () => {
  it("sin correcciones devuelve los valores del análisis, sin promptVersion ni model", () => {
    assert.deepEqual(applyCorrections(analysis, []), {
      dish: analysis.dish,
      items: analysis.items,
      kcal: analysis.kcal,
      macros: analysis.macros,
    });
  });

  it("aplica en orden: la última corrección de un campo gana", () => {
    const values = applyCorrections(analysis, [
      correction("dish", "Milanesa napolitana"),
      correction("kcal", { min: 800, max: 900 }),
      correction("dish", "Milanesa napolitana con puré"),
    ]);
    assert.equal(values.dish, "Milanesa napolitana con puré");
    assert.deepEqual(values.kcal, { min: 800, max: 900 });
    assert.deepEqual(values.macros, analysis.macros);
  });

  it("items y macros se reemplazan enteros", () => {
    const items = [{ name: "Puré", grams: { min: 200, max: 250 }, kcal: { min: 180, max: 230 } }];
    const macros = {
      protein: { min: 10, max: 12 },
      carbs: { min: 30, max: 35 },
      fat: { min: 5, max: 8 },
    };
    const values = applyCorrections(analysis, [
      correction("items", items),
      correction("macros", macros),
    ]);
    assert.deepEqual(values.items, items);
    assert.deepEqual(values.macros, macros);
  });

  it("ignora campos desconocidos y valores que no pasan zod", () => {
    const values = applyCorrections(analysis, [
      correction("confidence", 1),
      correction("promptVersion", "hackeado"),
      correction("__proto__", { dish: "prototipo" }),
      correction("kcal", { min: 900, max: 100 }),
      correction("dish", ""),
      correction("macros", { protein: { min: 1, max: 2 } }),
      correction("items", [{ name: "Sin rangos" }]),
    ]);
    assert.deepEqual(values, applyCorrections(analysis, []));
    assert.equal(Object.getPrototypeOf(values), Object.prototype);
  });

  it("no modifica el análisis original", () => {
    const before = structuredClone(analysis);
    applyCorrections(analysis, [
      correction("dish", "Otro"),
      correction("kcal", { min: 1, max: 2 }),
    ]);
    assert.deepEqual(analysis, before);
  });
});

describe("toMealResponse", () => {
  const base = {
    _id: new Types.ObjectId(),
    capturedAt: AT,
    corrections: [],
  } satisfies Partial<MealResponseSource>;

  it("las ranges salen solo con min y max, aunque el documento traiga otras claves", () => {
    const dirty = {
      ...analysis,
      kcal: { min: 620, max: 780, extra: "x" },
      items: [{ ...analysis.items[0], secret: "x", grams: { min: 1, max: 2, extra: "x" } }],
    };
    const response = toMealResponse({ ...base, status: "ready", analysis: dirty }, PHOTO_URL);
    assert.ok(response.status === "ready");
    assert.deepEqual(response.kcal, { min: 620, max: 780 });
    assert.deepEqual(response.items, [
      { name: "Milanesa", grams: { min: 1, max: 2 }, kcal: { min: 380, max: 470 } },
    ]);
  });

  it("ready sin análisis o failed sin error.code es un documento inconsistente: lanza", () => {
    assert.throws(() => toMealResponse({ ...base, status: "ready" }, PHOTO_URL), /sin análisis/);
    assert.throws(() => toMealResponse({ ...base, status: "failed" }, PHOTO_URL), /sin error/);
  });
});

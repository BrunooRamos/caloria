import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import type { CorrectMealInput } from "@caloria/shared";
import type { MealAnalysisQueue } from "../src/jobs/meal-analysis";
import { MealModel } from "../src/models/Meal";
import type { MealAnalysis, Range } from "../src/models/Meal";
import { backfillMealSearch } from "../src/scripts/backfill-meal-search";
import {
  createOpenAiDishIdentifier,
  IDENTIFY_MAX_ITEMS,
  IDENTIFY_TIMEOUT_MS,
} from "../src/services/dish-identifier";
import { createMealService } from "../src/services/meals";
import type { MediaService } from "../src/services/media";
import {
  createMongoSimilarMealsFinder,
  SIMILAR_MEALS_LIMIT,
  toSearchText,
} from "../src/services/similar-meals";
import { formatSimilarMeals } from "../src/services/similar-meals-context";
import { fixtures, unlimitedQuota } from "./helpers";

const r = (min: number, max: number): Range => ({ min, max });

const analysisOf = (
  dish: string,
  items: string[] = [],
  kcal: Range = r(620, 780),
): MealAnalysis => ({
  dish,
  items: items.map((name) => ({ name, grams: r(100, 150), kcal: r(200, 300) })),
  kcal,
  macros: { protein: r(38, 46), carbs: r(50, 65), fat: r(28, 38) },
  confidence: 0.7,
  promptVersion: "1.1.0",
  model: "gpt-fake",
});

const media: MediaService = {
  signedUrl: async () => "http://localhost:9000/firmada",
  download: () => Promise.reject(new Error("no se usa")),
  upload: () => Promise.reject(new Error("no se usa")),
  remove: () => Promise.reject(new Error("no se usa")),
  removeUserMedia: () => Promise.reject(new Error("no se usa")),
};
const queue: MealAnalysisQueue = { async enqueue() {}, async ready() {}, async close() {} };
const meals = createMealService({ media, queue, quota: unlimitedQuota });
const finder = createMongoSimilarMealsFinder();

let capturedAt = Date.parse("2026-10-01T12:00:00Z");

async function readyMeal(
  userId: Types.ObjectId,
  analysis: MealAnalysis,
  fields: Record<string, unknown> = {},
) {
  const _id = new Types.ObjectId();
  capturedAt += 60_000;
  await MealModel.create({
    _id,
    userId,
    capturedAt: new Date(capturedAt),
    localDate: "2026-10-01",
    status: "ready",
    media: { photoKey: `users/${userId}/meals/${_id}/photo.jpg` },
    analysis,
    ...fields,
  });
  return _id;
}

/** Comida corregida por el camino real: el PATCH es el que escribe `search`. */
async function correctedMeal(
  userId: Types.ObjectId,
  analysis: MealAnalysis,
  correction: CorrectMealInput,
) {
  const id = await readyMeal(userId, analysis);
  await meals.correct(userId.toString(), id.toString(), correction);
  return id;
}

const find = (userId: Types.ObjectId, terms: string[], excludeMealId = new Types.ObjectId()) =>
  finder.find({ userId, excludeMealId, terms }).then((found) => found.map(({ id }) => String(id)));

describe("back-service: comidas similares (RF-07)", () => {
  let mongo: MongoMemoryServer;
  let user: Types.ObjectId;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await MealModel.init();
  });
  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });
  beforeEach(async () => {
    await MealModel.deleteMany({});
    user = new Types.ObjectId();
  });

  describe("lo que se indexa", () => {
    it("el PATCH guarda en search el plato y los ingredientes finales", async () => {
      const id = await readyMeal(user, analysisOf("Milanesa", ["Milanesa", "Puré"]));
      await meals.correct(user.toString(), id.toString(), { dish: "Milanesa napolitana" });
      let saved = await MealModel.findById(id).lean();
      assert.deepEqual(saved?.search, { dish: "Milanesa napolitana", items: ["Milanesa", "Puré"] });
      // `analysis` queda como lo dijo la IA.
      assert.equal(saved?.analysis?.dish, "Milanesa");

      await meals.correct(user.toString(), id.toString(), {
        items: [{ name: "Milanesa de carne", grams: r(200, 200), kcal: r(500, 500) }],
      });
      saved = await MealModel.findById(id).lean();
      assert.deepEqual(saved?.search, {
        dish: "Milanesa napolitana",
        items: ["Milanesa de carne"],
      });
    });

    it("un PATCH sin cambios no escribe search", async () => {
      const id = await readyMeal(user, analysisOf("Milanesa"));
      await meals.correct(user.toString(), id.toString(), { dish: "Milanesa" });
      assert.equal((await MealModel.findById(id).lean())?.search, undefined);
    });

    it("el backfill completa search en las comidas corregidas antes de RF-07, una sola vez", async () => {
      const old = await readyMeal(user, analysisOf("Milanesa", ["Milanesa"]), {
        corrections: [
          { field: "dish", from: "Milanesa", to: "Milanesa napolitana", at: new Date() },
        ],
      });
      const uncorrected = await readyMeal(user, analysisOf("Milanesa"));

      assert.equal(await backfillMealSearch(), 1);
      assert.deepEqual((await MealModel.findById(old).lean())?.search, {
        dish: "Milanesa napolitana",
        items: ["Milanesa"],
      });
      assert.equal((await MealModel.findById(uncorrected).lean())?.search, undefined);
      assert.deepEqual(await find(user, ["napolitana"]), [old.toString()]);
      assert.equal(await backfillMealSearch(), 0);
    });
  });

  describe("la búsqueda", () => {
    it("encuentra por plato, en plural, en mayúsculas y sin tildes", async () => {
      const id = await correctedMeal(user, analysisOf("Milanesa"), {
        dish: "Milanesa a la plancha",
      });
      for (const terms of [["milanesas"], ["MILANESA"], ["planchá"]]) {
        assert.deepEqual(await find(user, terms), [id.toString()], terms.join());
      }
    });

    it("encuentra por ingrediente", async () => {
      const id = await correctedMeal(user, analysisOf("Tortilla", ["Huevo", "Papa", "Cebolla"]), {
        dish: "Tortilla de papas",
      });
      assert.deepEqual(await find(user, ["cebollas caramelizadas"]), [id.toString()]);
      assert.deepEqual(await find(user, ["Puré de papa"]), [id.toString()]);
    });

    it("busca por los valores corregidos, no por los de la IA", async () => {
      const id = await correctedMeal(user, analysisOf("Pollo al horno", ["Pollo"]), {
        dish: "Tofu al horno",
        items: [{ name: "Tofu", grams: r(150, 150), kcal: r(220, 220) }],
      });
      assert.deepEqual(await find(user, ["pollo"]), []);
      assert.deepEqual(await find(user, ["tofu"]), [id.toString()]);
    });

    it("no mezcla usuarios", async () => {
      const other = new Types.ObjectId();
      await correctedMeal(other, analysisOf("Milanesa"), { dish: "Milanesa napolitana" });
      assert.deepEqual(await find(user, ["milanesa"]), []);
      assert.equal(await finder.hasCandidates(user), false);
      assert.equal(await finder.hasCandidates(other), true);
    });

    it("ignora las comidas sin correcciones y las que no están ready", async () => {
      await readyMeal(user, analysisOf("Milanesa", ["Milanesa"]));
      // Con search pero sin correcciones o sin estar ready: no pasa con el PATCH, pero el filtro
      // no depende de eso.
      const search = { dish: "Milanesa", items: [] };
      await readyMeal(user, analysisOf("Milanesa"), { search });
      await readyMeal(user, analysisOf("Milanesa"), {
        status: "failed",
        error: { code: "NOT_FOOD" },
        search,
        corrections: [{ field: "dish", from: "Milanesa", to: "Milanesa", at: new Date() }],
      });
      assert.deepEqual(await find(user, ["milanesa"]), []);
      assert.equal(await finder.hasCandidates(user), false);
    });

    it("excluye la comida que se está analizando", async () => {
      const id = await correctedMeal(user, analysisOf("Milanesa"), { dish: "Milanesa napolitana" });
      assert.deepEqual(await find(user, ["milanesa"], id), []);
    });

    it(`trae hasta ${SIMILAR_MEALS_LIMIT}, la más parecida primero`, async () => {
      for (let i = 0; i < SIMILAR_MEALS_LIMIT + 2; i++) {
        await correctedMeal(user, analysisOf("Milanesa", ["Milanesa"]), { dish: `Milanesa ${i}` });
      }
      const best = await correctedMeal(user, analysisOf("Milanesa", ["Milanesa", "Puré de papa"]), {
        dish: "Milanesa con puré",
      });
      const found = await find(user, ["Milanesa con puré", "milanesa", "puré de papa"]);
      assert.equal(found.length, SIMILAR_MEALS_LIMIT);
      assert.equal(found[0], best.toString());
    });

    it("devuelve lo que necesita el prompt: el análisis y las correcciones", async () => {
      const id = await correctedMeal(user, analysisOf("Milanesa", ["Milanesa"]), {
        kcal: r(900, 900),
      });
      const [found] = await finder.find({
        userId: user,
        excludeMealId: new Types.ObjectId(),
        terms: ["milanesa"],
      });
      assert.equal(String(found.id), id.toString());
      assert.equal(found.analysis.dish, "Milanesa");
      assert.deepEqual(
        found.corrections.map(({ field, to }) => ({ field, to })),
        [{ field: "kcal", to: r(900, 900) }],
      );
    });

    it("sin términos útiles no busca, y un guion no excluye", async () => {
      const id = await correctedMeal(user, analysisOf("Milanesa"), { dish: "Milanesa napolitana" });
      assert.deepEqual(await find(user, ["", "  ", '-- ""']), []);
      assert.deepEqual(await find(user, ["-milanesa", '"napolitana casera"']), [id.toString()]);
    });

    it("el texto de búsqueda queda en palabras sueltas, sin repetir", () => {
      assert.equal(
        toSearchText(['Milanesa "con" puré', "-milanesa", "puré de papa"]),
        "milanesa con puré de papa",
      );
    });
  });
});

describe("back-service: contexto de comidas similares para el prompt", () => {
  const id = new Types.ObjectId();
  const item = (name: string, grams: Range, kcal: Range) => ({ name, grams, kcal });
  const analysis = {
    dish: "Milanesa",
    items: [item("Milanesa", r(150, 190), r(380, 470)), item("Puré", r(200, 250), r(180, 240))],
    kcal: r(620, 780),
    macros: { protein: r(38, 46), carbs: r(50, 65), fat: r(28, 38) },
  };
  const at = new Date();
  const lineOf = (text: string) => JSON.parse(text.split("\n")[2]) as Record<string, unknown>;

  it("lleva el plato, los valores finales y el antes y el después de cada campo corregido", () => {
    const items = [
      item("Milanesa", r(220, 220), r(560, 560)),
      item("Papas fritas", r(150, 150), r(470, 470)),
    ];
    const text = formatSimilarMeals([
      {
        id,
        analysis,
        corrections: [
          { field: "dish", from: "Milanesa", to: "Milanesa napolitana", at },
          { field: "items", from: analysis.items, to: items, at },
          { field: "kcal", from: r(620, 780), to: r(1030, 1030), at },
        ],
      },
    ]);
    assert.deepEqual(lineOf(text), {
      plato: "Milanesa napolitana",
      kcal: 1030,
      macros: { proteina: [38, 46], carbohidratos: [50, 65], grasas: [28, 38] },
      ingredientes: [
        { nombre: "Milanesa", g: 220, kcal: 560 },
        { nombre: "Papas fritas", g: 150, kcal: 470 },
      ],
      correcciones: [
        { campo: "plato", antes: "Milanesa", despues: "Milanesa napolitana" },
        {
          campo: "ingredientes",
          quitados: ["Puré"],
          agregados: [{ nombre: "Papas fritas", g: 150, kcal: 470 }],
          cambiados: [
            {
              nombre: "Milanesa",
              antes: { g: [150, 190], kcal: [380, 470] },
              despues: { g: 220, kcal: 560 },
            },
          ],
        },
        { campo: "kcal", antes: [620, 780], despues: 1030 },
      ],
    });
  });

  it("un campo que volvió al valor de la IA no figura como corrección", () => {
    const text = formatSimilarMeals([
      {
        id,
        analysis,
        corrections: [
          { field: "kcal", from: r(620, 780), to: r(900, 900), at },
          { field: "kcal", from: r(900, 900), to: r(620, 780), at },
          {
            field: "macros",
            from: analysis.macros,
            to: { ...analysis.macros, fat: r(40, 40) },
            at,
          },
        ],
      },
    ]);
    assert.deepEqual(lineOf(text).correcciones, [
      {
        campo: "macros",
        antes: { proteina: [38, 46], carbohidratos: [50, 65], grasas: [28, 38] },
        despues: { proteina: [38, 46], carbohidratos: [50, 65], grasas: 40 },
      },
    ]);
  });

  it("una comida por línea, en el orden en que llegan", () => {
    const meal = (dish: string) => ({
      id: new Types.ObjectId(),
      analysis,
      corrections: [{ field: "dish", from: "Milanesa", to: dish, at }],
    });
    const lines = formatSimilarMeals([meal("Primera"), meal("Segunda")]).split("\n");
    assert.equal(lines.length, 5);
    assert.deepEqual(
      lines.slice(2, 4).map((line) => (JSON.parse(line) as { plato: string }).plato),
      ["Primera", "Segunda"],
    );
  });
});

describe("back-service: identificar el plato con OpenAI (sin red)", () => {
  const prompt = { version: "1.0.0", system: "IDENTIFICÁ EL PLATO" };
  const PHOTO = fixtures.jpeg(64);

  const openAiResponse = (text: string, status = "completed") =>
    new Response(
      JSON.stringify({
        id: "resp_1",
        object: "response",
        created_at: 0,
        status,
        model: "gpt-6-luna-2026-09-01",
        output: [
          {
            type: "message",
            id: "msg_1",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text, annotations: [] }],
          },
        ],
        usage: {
          input_tokens: 180,
          output_tokens: 25,
          total_tokens: 205,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  it("manda solo la foto en baja resolución y pide el JSON del plato", async () => {
    const requests: Record<string, unknown>[] = [];
    const identifier = createOpenAiDishIdentifier({
      apiKey: "sk-test",
      model: "gpt-6-luna",
      prompt,
      fetch: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return openAiResponse(JSON.stringify({ dish: "Milanesa con puré", items: ["milanesa"] }));
      },
    });

    const result = await identifier.identify({ data: PHOTO, contentType: "image/jpeg" });
    assert.deepEqual(result, {
      dish: "Milanesa con puré",
      items: ["milanesa"],
      model: "gpt-6-luna-2026-09-01",
      promptVersion: "1.0.0",
      usage: { input: 180, output: 25, total: 205 },
    });
    const [body] = requests;
    assert.equal(body.model, "gpt-6-luna");
    assert.equal(body.instructions, "IDENTIFICÁ EL PLATO");
    assert.equal(body.store, false);
    const format = (body.text as { format: Record<string, unknown> }).format;
    assert.equal(format.type, "json_schema");
    assert.equal(format.strict, true);
    const [message] = body.input as { content: { type: string; detail?: string }[] }[];
    assert.deepEqual(
      message.content.map(({ type, detail }) => ({ type, detail })),
      [{ type: "input_image", detail: "low" }],
    );
  });

  it("recorta los nombres, descarta los vacíos y se queda con los primeros ingredientes", async () => {
    const items = ["  milanesa  ", "", ...Array.from({ length: 12 }, (_, i) => `ingrediente ${i}`)];
    const identifier = createOpenAiDishIdentifier({
      apiKey: "sk-test",
      model: "gpt-6-luna",
      prompt,
      fetch: async () => openAiResponse(JSON.stringify({ dish: `  ${"m".repeat(300)} `, items })),
    });
    const result = await identifier.identify({ data: PHOTO, contentType: "image/jpeg" });
    assert.equal(result.dish.length, 100);
    assert.equal(result.items.length, IDENTIFY_MAX_ITEMS);
    assert.equal(result.items[0], "milanesa");
  });

  it("una respuesta incompleta o que no es JSON lanza", async () => {
    for (const response of [
      () => openAiResponse("{}", "incomplete"),
      () => openAiResponse("no es json"),
    ]) {
      const identifier = createOpenAiDishIdentifier({
        apiKey: "sk-test",
        model: "gpt-6-luna",
        prompt,
        fetch: async () => response(),
      });
      await assert.rejects(identifier.identify({ data: PHOTO, contentType: "image/jpeg" }));
    }
  });

  it("tiene un timeout corto, porque corre antes del análisis", () => {
    assert.ok(IDENTIFY_TIMEOUT_MS <= 6_000);
  });
});

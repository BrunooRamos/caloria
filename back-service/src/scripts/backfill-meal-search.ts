// Completa `search` en las comidas corregidas antes de que el PATCH lo escribiera. Se corre
// una vez después de desplegar y se puede repetir: solo toca las que no lo tienen.
//   docker compose -f infra/docker-compose.yml run --rm back node dist/scripts/backfill-meal-search.js
import mongoose from "mongoose";
import type { Types } from "mongoose";
import { createLogger, serializeError } from "@caloria/shared";
import { connectMongo } from "../config/db";
import { MealModel } from "../models/Meal";
import type { Correction, MealAnalysis } from "../models/Meal";
import { applyCorrections, toMealSearch } from "../services/meal-corrections";

const logger = createLogger({ service: "backfill-meal-search" });

export async function backfillMealSearch(): Promise<number> {
  const pending = MealModel.find(
    { status: "ready", "corrections.0": { $exists: true }, search: { $exists: false } },
    { analysis: 1, corrections: 1 },
  )
    .lean<{ _id: Types.ObjectId; analysis?: MealAnalysis; corrections: Correction[] }[]>()
    .cursor();
  let updated = 0;
  for await (const meal of pending) {
    if (!meal.analysis) continue;
    const search = toMealSearch(applyCorrections(meal.analysis, meal.corrections));
    // Si un PATCH lo escribió mientras tanto, ese es el bueno: no se pisa.
    const result = await MealModel.updateOne(
      { _id: meal._id, search: { $exists: false } },
      { $set: { search } },
    );
    updated += result.modifiedCount;
  }
  return updated;
}

if (require.main === module) {
  (async () => {
    await connectMongo();
    await MealModel.init();
    const updated = await backfillMealSearch();
    logger.info("backfill de search terminado", { updated });
    await mongoose.disconnect();
  })().catch((err: unknown) => {
    logger.error("backfill de search falló", { err: serializeError(err, { stack: true }) });
    process.exit(1);
  });
}

import { parseArgs } from "node:util";
import mongoose from "mongoose";
import { formatMonthlyAiCosts, monthlyAiCosts } from "../services/ai-costs";

// Resumen del gasto en IA del mes y el promedio por usuario activo (RNF-07).
//   npm run ai-costs                       → el mes actual (UTC)
//   npm run ai-costs -- --month 2026-10    → ese mes
//   npm run ai-costs -- --json             → el mismo resumen en JSON
// En el servidor: docker compose -f infra/docker-compose.yml exec back node dist/scripts/ai-costs.js
async function main() {
  const { values } = parseArgs({
    options: { month: { type: "string" }, json: { type: "boolean", default: false } },
  });
  const month = values.month ?? new Date().toISOString().slice(0, 7);
  const mongoUri = process.env.MONGO_URI?.trim();
  if (!mongoUri) throw new Error("Falta la variable de entorno MONGO_URI");

  // Sin connectMongo: no reintenta para siempre ni escribe en stdout (rompería el --json).
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  try {
    const report = await monthlyAiCosts(month);
    console.log(values.json ? JSON.stringify(report, null, 2) : formatMonthlyAiCosts(report));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

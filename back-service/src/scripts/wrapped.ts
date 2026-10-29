import { parseArgs } from "node:util";
import { createLogger, isoWeekSchema, serializeError } from "@caloria/shared";
import { createWeeklySummaryQueue, WEEKLY_SUMMARY_QUEUE } from "../jobs/weekly-summary";

// Dispara el fan-out del Wrapped sin esperar al lunes. Lo procesa el worker que esté corriendo.
//   npm run wrapped                     → la semana anterior a hoy
//   npm run wrapped -- --week 2026-W43  → esa semana
const logger = createLogger({ service: "worker" });

async function main() {
  const { values } = parseArgs({ options: { week: { type: "string" } } });
  const week = values.week === undefined ? undefined : isoWeekSchema.parse(values.week);
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) throw new Error("Falta la variable de entorno REDIS_URL");

  const queue = createWeeklySummaryQueue({ redisUrl, logger });
  try {
    await queue.ready();
    await queue.fanOutNow(week);
    logger.info(`fan-out del Wrapped encolado en ${WEEKLY_SUMMARY_QUEUE}`, {
      week: week ?? "anterior",
    });
  } finally {
    await queue.close();
  }
}

main().catch((err: unknown) => {
  logger.error("no se pudo encolar el fan-out del Wrapped", { err: serializeError(err) });
  process.exit(1);
});

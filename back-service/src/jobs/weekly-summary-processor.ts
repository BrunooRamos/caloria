import { Types } from "mongoose";
import { isoWeekSchema, previousIsoWeek } from "@caloria/shared";
import type { Logger } from "@caloria/shared";
import { WeeklySummaryModel } from "../models/WeeklySummary";
import { InvalidInsightsResponseError } from "../services/insights";
import type { InsightsService } from "../services/insights";
import { localDateIn } from "../services/local-date";
import type { WeeklyMetricsService } from "../services/weekly-metrics";
import { WEEKLY_SUMMARY_TZ } from "./weekly-summary";
import type { WeeklyFanOutJob, WeeklySummaryJob, WeeklySummaryQueue } from "./weekly-summary";

export interface WeeklyFanOutDeps {
  metrics: Pick<WeeklyMetricsService, "usersWithMeals">;
  queue: Pick<WeeklySummaryQueue, "enqueueSummaries">;
  now?: () => Date;
}

export type WeeklyFanOut = (
  job: WeeklyFanOutJob,
  log: Logger,
) => Promise<{ week: string; enqueued: number }>;

/** El job del cron: solo reparte. Un job por usuario con comidas ready en la semana. */
export function createWeeklyFanOut({
  metrics,
  queue,
  now = () => new Date(),
}: WeeklyFanOutDeps): WeeklyFanOut {
  return async ({ week: requested }, log) => {
    const started = performance.now();
    // Sin semana pedida, la anterior al día de hoy en Montevideo: el lunes 06:00 ya es lunes.
    const week = requested
      ? isoWeekSchema.parse(requested)
      : previousIsoWeek(localDateIn(WEEKLY_SUMMARY_TZ, now()));
    const users = await metrics.usersWithMeals(week);
    const enqueued = await queue.enqueueSummaries(users.map((userId) => ({ userId, week })));
    log.info("fan-out del Wrapped", {
      week,
      users: enqueued,
      durationMs: Math.round(performance.now() - started),
    });
    return { week, enqueued };
  };
}

/** Qué pasó con el job, para el log. Salvo `generated`, ninguno llama a la IA. */
export type WeeklySummaryOutcome = "generated" | "skipped" | "no-meals" | "exists";

export type WeeklySummaryProcessor = (
  job: WeeklySummaryJob,
  log: Logger,
) => Promise<WeeklySummaryOutcome>;

export interface WeeklySummaryProcessorDeps {
  metrics: Pick<WeeklyMetricsService, "compute">;
  insights: InsightsService;
  now?: () => Date;
}

const isDuplicateKey = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { code?: unknown }).code === 11000;

/**
 * Un Wrapped. Si ya está ready, termina sin llamar a la IA (se paga). Si falla la IA o zod,
 * lanza: BullMQ reintenta y el resumen no queda ready.
 */
export function createWeeklySummaryProcessor({
  metrics,
  insights,
  now = () => new Date(),
}: WeeklySummaryProcessorDeps): WeeklySummaryProcessor {
  return async ({ userId, week }, log) => {
    const key = { userId: new Types.ObjectId(userId), week };
    const existing = await WeeklySummaryModel.findOne(key, { status: 1 }).lean();
    if (existing?.status === "ready") {
      log.info("el Wrapped ya está ready, se saltea");
      return "skipped";
    }

    const data = await metrics.compute(userId, week);
    if (!data) {
      // Por ejemplo, borró las comidas después del fan-out: no hay nada que resumir.
      log.info("sin comidas ready en la semana, no se genera el Wrapped");
      return "no-meals";
    }

    const started = performance.now();
    const durationMs = () => Math.round(performance.now() - started);
    let result;
    try {
      result = await insights.generate(data);
    } catch (err) {
      // Solo los issues de zod: ni la respuesta cruda ni los insights.
      if (err instanceof InvalidInsightsResponseError) {
        log.warn("la IA devolvió insights inválidos", {
          model: err.info.model,
          promptVersion: err.info.promptVersion,
          durationMs: durationMs(),
          usage: err.info.usage,
          issues: err.issues,
        });
      }
      throw err;
    }
    const elapsedMs = durationMs();

    // El filtro excluye los ready: dos jobs a la vez no se pisan. Si el otro ya lo dejó ready,
    // el upsert choca con el índice único: ya existe.
    let saved = true;
    try {
      await WeeklySummaryModel.updateOne(
        { ...key, status: { $ne: "ready" } },
        {
          $set: {
            status: "ready",
            metrics: data.metrics,
            insights: result.insights,
            promptVersion: result.promptVersion,
            generatedAt: now(),
          },
        },
        { upsert: true, runValidators: true },
      );
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      saved = false;
    }

    // Ni los insights ni los platos van al log: solo cuántos y con qué se generaron.
    log.info("insights del Wrapped", {
      model: result.model,
      promptVersion: result.promptVersion,
      // Tokens consumidos; la clave no puede contener "token" porque el logger la redacta.
      usage: result.usage,
      insights: result.insights.length,
      durationMs: elapsedMs,
      saved,
    });
    if (!saved) {
      log.info("otro job dejó el Wrapped ready primero, no se pisa");
      return "exists";
    }
    // #38: acá va el push "Wrapped listo".
    return "generated";
  };
}

/** Se agotaron los reintentos: el resumen queda failed, salvo que otro job ya lo haya dejado ready. */
export async function markWeeklySummaryFailed({ userId, week }: WeeklySummaryJob): Promise<void> {
  try {
    await WeeklySummaryModel.updateOne(
      { userId: new Types.ObjectId(userId), week, status: { $ne: "ready" } },
      { $set: { status: "failed" } },
      { upsert: true, runValidators: true },
    );
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
  }
}

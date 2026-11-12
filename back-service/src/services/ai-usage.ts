import type { Types } from "mongoose";
import { serializeError } from "@caloria/shared";
import type { Logger } from "@caloria/shared";
import { estimateCostUsd } from "../config/ai-pricing";
import { AiUsageModel } from "../models/AiUsage";
import type { AiCallKind } from "../models/AiUsage";

export interface AiUsageEntry {
  kind: AiCallKind;
  model: string;
  userId?: Types.ObjectId | string;
  mealId?: Types.ObjectId | string;
  usage?: { input: number; output: number };
  audioSeconds?: number;
}

export interface AiUsageRecorder {
  /** Loguea y guarda la llamada con su costo estimado. Nunca lanza: el registro no frena un análisis. */
  record(entry: AiUsageEntry, log: Logger): Promise<void>;
}

export function createAiUsageRecorder({ now = () => new Date() } = {}): AiUsageRecorder {
  return {
    async record({ kind, model, userId, mealId, usage, audioSeconds }, log) {
      const costUsd = estimateCostUsd({ model, usage, audioSeconds });
      // La clave no puede contener "token": el logger la redacta.
      log.info("costo de IA", {
        kind,
        model,
        ...(usage && { usage: { input: usage.input, output: usage.output } }),
        ...(audioSeconds !== undefined && { audioSeconds }),
        costUsd,
      });
      if (costUsd === null) log.warn("modelo sin precio en config/ai-pricing", { kind, model });
      try {
        await AiUsageModel.create({
          at: now(),
          kind,
          model,
          ...(userId && { userId }),
          ...(mealId && { mealId }),
          ...(usage && { usage: { input: usage.input, output: usage.output } }),
          ...(audioSeconds !== undefined && { audioSeconds }),
          costUsd,
        });
      } catch (err) {
        log.error("no se pudo guardar el costo de IA", { kind, err: serializeError(err) });
      }
    },
  };
}

import { Schema, model, type Types } from "mongoose";

/** Para qué se llamó a la IA. */
export const AI_CALL_KINDS = [
  "analysis",
  "identify",
  "comment",
  "transcription",
  "insights",
] as const;
export type AiCallKind = (typeof AI_CALL_KINDS)[number];

/**
 * Una llamada a la IA con lo que consumió y lo que costó (RNF-07). Se escribe también si la
 * respuesta no pasó la validación: esos tokens se pagan igual. Nunca guarda el contenido.
 */
export interface AiUsage {
  _id: Types.ObjectId;
  at: Date;
  kind: AiCallKind;
  model: string;
  userId?: Types.ObjectId;
  mealId?: Types.ObjectId;
  /** Tokens de entrada y salida (los modelos que cobran por token). */
  usage?: { input: number; output: number };
  /** Segundos de audio (transcripción). */
  audioSeconds?: number;
  /** USD estimados con config/ai-pricing. null si el modelo no tiene precio cargado. */
  costUsd: number | null;
}

const aiUsageSchema = new Schema<AiUsage>(
  {
    at: { type: Date, required: true },
    kind: { type: String, enum: AI_CALL_KINDS, required: true },
    model: { type: String, required: true },
    userId: Schema.Types.ObjectId,
    mealId: Schema.Types.ObjectId,
    usage: new Schema(
      { input: { type: Number, required: true }, output: { type: Number, required: true } },
      { _id: false },
    ),
    audioSeconds: Number,
    costUsd: { type: Number, default: null },
  },
  { collection: "ai_usage" },
);

// El resumen del mes filtra por fecha.
aiUsageSchema.index({ at: 1 });
export const AiUsageModel = model<AiUsage>("AiUsage", aiUsageSchema);

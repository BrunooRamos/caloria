import { Schema, model, type Types } from "mongoose";
import type { WeeklyMetrics } from "@caloria/shared";

export const WEEKLY_SUMMARY_STATUSES = ["pending", "ready", "failed"] as const;
export type WeeklySummaryStatus = (typeof WEEKLY_SUMMARY_STATUSES)[number];

/** RF-12. `metrics`, `insights`, `promptVersion` y `generatedAt` solo existen con status "ready". */
export interface WeeklySummary {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  week: string; // semana ISO, ej. "2026-W43"
  status: WeeklySummaryStatus;
  metrics?: WeeklyMetrics;
  insights?: string[];
  promptVersion?: string;
  generatedAt?: Date;
}

// En los update validators `this` es la query (o undefined): ahí no aplica.
const isReady = function (this: WeeklySummary | undefined) {
  return this?.status === "ready";
};

const weeklySummarySchema = new Schema<WeeklySummary>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    week: { type: String, required: true, match: /^\d{4}-W\d{2}$/ },
    status: { type: String, enum: WEEKLY_SUMMARY_STATUSES, required: true, default: "pending" },
    metrics: {
      type: new Schema<WeeklyMetrics>(
        {
          avgKcal: { type: Number, required: true },
          daysLogged: { type: Number, required: true },
          streak: { type: Number, required: true },
          topDish: { type: String, required: true },
        },
        { _id: false },
      ),
      required: isReady,
    },
    // Sin default: un resumen que no está ready no tiene insights.
    insights: { type: [String], default: undefined, required: isReady },
    promptVersion: { type: String, required: isReady },
    generatedAt: { type: Date, required: isReady },
  },
  { collection: "weekly_summaries" },
);

// Una sola fila por usuario y semana: el cron no duplica aunque corra dos veces.
weeklySummarySchema.index({ userId: 1, week: 1 }, { unique: true });

export const WeeklySummaryModel = model<WeeklySummary>("WeeklySummary", weeklySummarySchema);

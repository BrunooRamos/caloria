import { Schema, model, type Types } from "mongoose";

export const MEAL_STATUSES = ["processing", "ready", "failed"] as const;
export type MealStatus = (typeof MEAL_STATUSES)[number];

export interface Range {
  min: number;
  max: number;
}

export interface MealMedia {
  photoKey: string;
  audioKey?: string;
}

export interface MealAnalysis {
  dish: string;
  items: { name: string; grams: Range; kcal: Range }[];
  kcal: Range;
  macros: { protein: Range; carbs: Range; fat: Range };
  confidence: number; // 0 a 1
  promptVersion: string;
  model: string;
}

export interface Correction {
  field: string;
  from: unknown;
  to: unknown;
  at: Date;
}

export interface Meal {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  capturedAt: Date;
  localDate: string; // "YYYY-MM-DD" en la zona del usuario
  status: MealStatus;
  media: MealMedia;
  transcript?: string;
  note?: string;
  analysis?: MealAnalysis;
  corrections: Correction[];
  comment?: { tone: string; text: string };
  attempts: number;
  error?: { code: string };
}

const rangeSchema = new Schema<Range>(
  { min: { type: Number, required: true }, max: { type: Number, required: true } },
  { _id: false },
);

const analysisSchema = new Schema<MealAnalysis>(
  {
    dish: { type: String, required: true },
    items: {
      type: [
        new Schema(
          {
            name: { type: String, required: true },
            grams: { type: rangeSchema, required: true },
            kcal: { type: rangeSchema, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    kcal: { type: rangeSchema, required: true },
    macros: {
      type: new Schema(
        {
          protein: { type: rangeSchema, required: true },
          carbs: { type: rangeSchema, required: true },
          fat: { type: rangeSchema, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    promptVersion: { type: String, required: true },
    model: { type: String, required: true },
  },
  { _id: false },
);

const mealSchema = new Schema<Meal>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    capturedAt: { type: Date, required: true },
    localDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    status: { type: String, enum: MEAL_STATUSES, required: true, default: "processing" },
    media: {
      type: new Schema<MealMedia>(
        { photoKey: { type: String, required: true }, audioKey: String },
        { _id: false },
      ),
      required: true,
    },
    transcript: String,
    note: String,
    analysis: analysisSchema,
    corrections: {
      type: [
        new Schema<Correction>(
          {
            field: { type: String, required: true },
            from: Schema.Types.Mixed,
            to: Schema.Types.Mixed,
            at: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    comment: new Schema({ tone: String, text: String }, { _id: false }),
    attempts: { type: Number, required: true, default: 0 },
    error: new Schema({ code: { type: String, required: true } }, { _id: false }),
  },
  { collection: "meals" },
);

mealSchema.index({ userId: 1, capturedAt: -1 });
mealSchema.index({ userId: 1, localDate: 1 });

export const MealModel = model<Meal>("Meal", mealSchema);

import { Schema, model, type Types } from "mongoose";
import { MEAL_ERROR_CODES } from "@caloria/shared";
import type { MealErrorCode } from "@caloria/shared";

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
  /** Comidas corregidas que la IA recibió como contexto. Sin este campo, análisis previo a RF-07. */
  contextMealIds?: Types.ObjectId[];
}

/**
 * Plato y nombres de ingredientes finales (con las correcciones aplicadas), solo para el
 * índice de texto. Lo escribe el PATCH: solo lo tienen las comidas corregidas.
 */
export interface MealSearch {
  dish: string;
  items: string[];
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
  search?: MealSearch;
  comment?: { tone: string; text: string };
  attempts: number;
  error?: { code: MealErrorCode };
  quotaMonth?: string;
  quotaRefunded?: boolean;
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
    contextMealIds: { type: [Schema.Types.ObjectId], default: undefined },
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
    search: new Schema<MealSearch>(
      { dish: { type: String, required: true }, items: { type: [String], default: [] } },
      { _id: false },
    ),
    comment: new Schema({ tone: String, text: String }, { _id: false }),
    attempts: { type: Number, required: true, default: 0 },
    error: new Schema(
      { code: { type: String, enum: MEAL_ERROR_CODES, required: true } },
      { _id: false },
    ),
    quotaMonth: { type: String, match: /^\d{4}-\d{2}$/ },
    quotaRefunded: Boolean,
  },
  { collection: "meals" },
);

// Comidas corregidas parecidas. Con userId adelante, Mongo exige igualdad sobre él: la
// búsqueda nunca sale del usuario. En español ("milanesas" encuentra "milanesa"); el plato pesa más.
mealSchema.index(
  { userId: 1, "search.dish": "text", "search.items": "text" },
  {
    name: "similar_meals",
    default_language: "spanish",
    weights: { "search.dish": 3, "search.items": 1 },
  },
);
mealSchema.index({ userId: 1, capturedAt: -1 });
// Historial del día (GET /meals) en orden y dashboard (prefijo { userId, localDate }).
mealSchema.index({ userId: 1, localDate: 1, capturedAt: 1, _id: 1 });
export const MealModel = model<Meal>("Meal", mealSchema);

import { model, Schema } from "mongoose";

const sessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true },
    family: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
  },
  { _id: false },
);

const planSchema = new Schema(
  {
    tier: { type: String, enum: ["free", "premium"], required: true, default: "free" },
    since: { type: Date, required: true, default: () => new Date() },
    renewsAt: { type: Date },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    profile: {
      sex: { type: String, enum: ["female", "male"], required: true },
      birthDate: { type: String, required: true },
      heightCm: { type: Number, required: true },
      weightKg: { type: Number, required: true },
      activity: {
        type: String,
        enum: ["sedentary", "light", "moderate", "active", "very_active"],
        required: true,
      },
      goal: { type: String, enum: ["lose", "maintain", "gain"], required: true },
      timezone: { type: String, required: true },
    },
    plan: { type: planSchema, required: true, default: () => ({}) },
    sessions: { type: [sessionSchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const User = model("User", userSchema);

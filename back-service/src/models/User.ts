import { Schema, model, type Types } from "mongoose";

export const SEXES = ["female", "male"] as const;
export const ACTIVITIES = ["sedentary", "light", "moderate", "active", "very_active"] as const;
export const GOALS = ["lose", "maintain", "gain"] as const;
export const TONES = ["motivador", "neutro", "roast", "off"] as const;
export const TIERS = ["free", "premium"] as const;

export interface Profile {
  sex: (typeof SEXES)[number];
  birthDate: string; // "YYYY-MM-DD"
  heightCm: number;
  weightKg: number;
  activity: (typeof ACTIVITIES)[number];
  goal: (typeof GOALS)[number];
  timezone: string;
}

export interface Targets {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface Plan {
  tier: (typeof TIERS)[number];
  since: Date;
  renewsAt?: Date;
}

export interface Usage {
  month: string; // "YYYY-MM"
  analyses: number;
}

export interface Session {
  tokenHash: string;
  family: string;
  expiresAt: Date;
  revokedAt?: Date;
}

export interface User {
  _id: Types.ObjectId;
  createdAt: Date;
  email: string;
  passwordHash: string;
  profile: Profile;
  targets: Targets;
  tone: (typeof TONES)[number];
  plan: Plan;
  usage: Usage;
  pushTokens: string[];
  sessions: Session[];
}

const profileSchema = new Schema<Profile>(
  {
    sex: { type: String, enum: SEXES, required: true },
    birthDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    heightCm: { type: Number, required: true },
    weightKg: { type: Number, required: true },
    activity: { type: String, enum: ACTIVITIES, required: true },
    goal: { type: String, enum: GOALS, required: true },
    timezone: { type: String, required: true },
  },
  { _id: false },
);

const targetsSchema = new Schema<Targets>(
  {
    kcal: { type: Number, required: true },
    proteinG: { type: Number, required: true },
    carbsG: { type: Number, required: true },
    fatG: { type: Number, required: true },
  },
  { _id: false },
);

const planSchema = new Schema<Plan>(
  {
    tier: { type: String, enum: TIERS, required: true, default: "free" },
    since: { type: Date, required: true, default: Date.now },
    renewsAt: Date,
  },
  { _id: false },
);

const usageSchema = new Schema<Usage>(
  {
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    analyses: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const sessionSchema = new Schema<Session>(
  {
    tokenHash: { type: String, required: true },
    family: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
  },
  { _id: false },
);

const userSchema = new Schema<User>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    profile: { type: profileSchema, required: true },
    targets: { type: targetsSchema, required: true },
    tone: { type: String, enum: TONES, required: true, default: "neutro" },
    plan: { type: planSchema, required: true, default: () => ({}) },
    usage: {
      type: usageSchema,
      required: true,
      default: () => ({ month: new Date().toISOString().slice(0, 7) }),
    },
    pushTokens: { type: [String], default: [] },
    sessions: { type: [sessionSchema], default: [] },
  },
  { collection: "users", timestamps: { createdAt: true, updatedAt: false } },
);

userSchema.index({ email: 1 }, { unique: true });

export const UserModel = model<User>("User", userSchema);

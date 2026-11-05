import { Schema, model, type Types } from "mongoose";
import { TONES } from "@caloria/shared";
import type { NotificationPreferences, Tone } from "@caloria/shared";

export const SEXES = ["female", "male"] as const;
export const ACTIVITIES = ["sedentary", "light", "moderate", "active", "very_active"] as const;
export const GOALS = ["lose", "maintain", "gain"] as const;
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

/** Estado de la suscripción normalizado: no depende del proveedor de pagos. */
export const SUBSCRIPTION_STATUSES = ["incomplete", "active", "past_due", "canceled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface Plan {
  tier: (typeof TIERS)[number];
  since: Date;
  status?: SubscriptionStatus;
  /** Fin del período pagado. Sin el campo y con tier premium: premium sin vencimiento (alta manual). */
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  /** Ids del proveedor de pagos. Nunca datos de tarjeta. */
  customerId?: string;
  subscriptionId?: string;
}

export interface Usage {
  month: string; // "YYYY-MM"
  analyses: number;
}

export interface Session {
  tokenHash: string;
  family: string;
  expiresAt: Date;
  rotatedAt?: Date;
  revokedAt?: Date;
}

export interface User {
  _id: Types.ObjectId;
  createdAt: Date;
  email: string;
  passwordHash: string;
  profile: Profile;
  targets: Targets;
  tone: Tone;
  plan: Plan;
  usage: Usage;
  pushTokens: string[]; // del más viejo al más nuevo, hasta 10
  // Opcional: los usuarios creados antes de RF-13 no lo tienen y valen los defaults.
  notifications?: Partial<NotificationPreferences>;
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
    status: { type: String, enum: SUBSCRIPTION_STATUSES },
    currentPeriodEnd: Date,
    cancelAtPeriodEnd: Boolean,
    customerId: String,
    subscriptionId: String,
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

const notificationsSchema = new Schema<NotificationPreferences>(
  {
    analysisReady: { type: Boolean, required: true, default: true },
    streakRisk: { type: Boolean, required: true, default: true },
    wrappedReady: { type: Boolean, required: true, default: true },
  },
  { _id: false },
);

const sessionSchema = new Schema<Session>(
  {
    tokenHash: { type: String, required: true },
    family: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    rotatedAt: Date,
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
    tone: { type: String, enum: TONES, required: true, default: "motivador" },
    plan: { type: planSchema, required: true, default: () => ({}) },
    usage: {
      type: usageSchema,
      required: true,
      default: () => ({ month: new Date().toISOString().slice(0, 7) }),
    },
    pushTokens: { type: [String], default: [] },
    notifications: { type: notificationsSchema, default: () => ({}) },
    sessions: { type: [sessionSchema], default: [] },
  },
  { collection: "users", timestamps: { createdAt: true, updatedAt: false } },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ "sessions.tokenHash": 1 });
// Para sacarle un token a otra cuenta cuando lo registra un usuario nuevo en el mismo teléfono.
userSchema.index({ pushTokens: 1 });
// El webhook del proveedor encuentra al usuario por su id de cliente.
userSchema.index(
  { "plan.customerId": 1 },
  { unique: true, partialFilterExpression: { "plan.customerId": { $type: "string" } } },
);

export const UserModel = model<User>("User", userSchema);

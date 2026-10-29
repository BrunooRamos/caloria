import { Schema, model, type Types } from "mongoose";

export interface Streak {
  current: number;
  best: number;
  lastLogDate: string; // "YYYY-MM-DD" en la zona del usuario
}

export interface Badge {
  code: string;
  at: Date;
}

export interface Gamification {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  streak: Streak;
  badges: Badge[];
}

const gamificationSchema = new Schema<Gamification>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    streak: {
      type: new Schema<Streak>(
        {
          current: { type: Number, required: true },
          best: { type: Number, required: true },
          lastLogDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
        },
        { _id: false },
      ),
      required: true,
    },
    badges: {
      type: [
        new Schema<Badge>(
          { code: { type: String, required: true }, at: { type: Date, required: true } },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { collection: "gamification" },
);

gamificationSchema.index({ userId: 1 }, { unique: true });

export const GamificationModel = model<Gamification>("Gamification", gamificationSchema);

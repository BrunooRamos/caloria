import { ageOn } from "@caloria/shared";
import type { Profile } from "@caloria/shared";
import type { Targets } from "../models/User";

const ACTIVITY_FACTOR: Record<Profile["activity"], number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const GOAL_ADJUSTMENT_KCAL: Record<Profile["goal"], number> = {
  lose: -500,
  maintain: 0,
  gain: 300,
};

/** RNF-10: nunca se recomienda menos que esto. */
export const MIN_KCAL = 1200;

/** Metas diarias según RF-02 (docs/modelo-datos.md, "Cálculo de metas"). */
export function computeTargets(profile: Profile, today = new Date()): Targets {
  const age = ageOn(profile.birthDate, today);
  const sexOffset = profile.sex === "male" ? 5 : -161;
  const bmr = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * age + sexOffset;
  const tdee = bmr * ACTIVITY_FACTOR[profile.activity];
  const kcal = Math.max(MIN_KCAL, Math.round(tdee + GOAL_ADJUSTMENT_KCAL[profile.goal]));

  const proteinG = Math.round(1.8 * profile.weightKg);
  const fatG = Math.round((kcal * 0.25) / 9);
  const carbsG = Math.max(0, Math.round((kcal - proteinG * 4 - fatG * 9) / 4));
  return { kcal, proteinG, carbsG, fatG };
}

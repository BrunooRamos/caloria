import { api } from "./api";
import type { Profile } from "./auth";

export interface Targets {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export type Tone = "motivador" | "neutro" | "roast" | "off";

export interface Me {
  id: string;
  email: string;
  profile: Profile;
  targets: Targets;
  tone: Tone;
  plan: { tier: "free" | "premium"; since: string; renewsAt?: string };
}

export function getMe(): Promise<Me> {
  return api.get<Me>("/users/me");
}

export function updateProfile(changes: Partial<Profile>): Promise<Me> {
  return api.patch<Me>("/users/me", { profile: changes });
}

/** El tono va solo: no manda el perfil ni recalcula las metas. */
export function updateTone(tone: Tone): Promise<Me> {
  return api.patch<Me>("/users/me", { tone });
}

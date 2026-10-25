import { api } from "./api";
import type { Profile } from "./auth";

export interface Targets {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface Me {
  id: string;
  email: string;
  profile: Profile;
  targets: Targets;
  tone: "motivador" | "neutro" | "roast" | "off";
  plan: { tier: "free" | "premium"; since: string; renewsAt?: string };
}

export function getMe(): Promise<Me> {
  return api.get<Me>("/users/me");
}

export function updateProfile(changes: Partial<Profile>): Promise<Me> {
  return api.patch<Me>("/users/me", { profile: changes });
}

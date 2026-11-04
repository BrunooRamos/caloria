import { api } from "./api";
import type { Profile } from "./auth";

export interface Targets {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export type Tone = "motivador" | "neutro" | "roast" | "off";

/** Tipos de aviso push que el usuario puede apagar (RF-13). Espejo de `@caloria/shared`. */
export type NotificationType = "analysisReady" | "streakRisk" | "wrappedReady";
export type NotificationPreferences = Record<NotificationType, boolean>;

export interface Me {
  id: string;
  email: string;
  profile: Profile;
  targets: Targets;
  tone: Tone;
  plan: { tier: "free" | "premium"; since: string; renewsAt?: string };
  notifications: NotificationPreferences;
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

/** Solo los tipos que cambian; el resto queda como estaba. */
export function updateNotifications(changes: Partial<NotificationPreferences>): Promise<Me> {
  return api.patch<Me>("/users/me", { notifications: changes });
}

/** El Backend suma el token a los que ya tiene: cada dispositivo manda solo el suyo. */
export function registerPushToken(token: string): Promise<Me> {
  return api.patch<Me>("/users/me", { pushTokens: [token] });
}

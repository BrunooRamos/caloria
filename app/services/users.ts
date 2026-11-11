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

/**
 * Borra la cuenta y todo lo suyo en el servidor. Responde 204; repetirlo con el mismo
 * token también, así un reintento después de perder la respuesta termina bien.
 */
export function deleteAccount(): Promise<void> {
  return api.delete("/users/me");
}

let devicePushToken: string | null = null;

/** El Backend suma el token a los que ya tiene: cada dispositivo manda solo el suyo. */
export async function registerPushToken(token: string): Promise<Me> {
  const me = await api.patch<Me>("/users/me", { pushTokens: [token] });
  devicePushToken = token;
  return me;
}

/**
 * El token que este dispositivo registró en la cuenta abierta, para sacarlo al cerrar sesión.
 * Se toma una sola vez: la próxima cuenta lo registra de nuevo al entrar.
 */
export function takeDevicePushToken(): string | null {
  const token = devicePushToken;
  devicePushToken = null;
  return token;
}

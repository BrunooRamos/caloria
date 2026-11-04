import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { registerPushToken } from "@/services/users";

/**
 * `denied`: se puede volver a preguntar. `blocked`: el sistema ya no pregunta y solo queda
 * la configuración del teléfono.
 */
export type PushPermission = "granted" | "undetermined" | "denied" | "blocked";

// Con la app abierta el aviso también se muestra como banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function toPermission(status: Notifications.NotificationPermissionsStatus): PushPermission {
  if (status.granted) return "granted";
  // En iOS el permiso provisorio entrega los avisos en silencio: alcanza para registrar el token.
  if (status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return "granted";
  if (status.status === Notifications.PermissionStatus.UNDETERMINED) return "undetermined";
  return status.canAskAgain ? "denied" : "blocked";
}

/** En Android 13+ el sistema no muestra el pedido de permiso hasta que existe un canal. */
async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "Avisos",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function getPushPermission(): Promise<PushPermission> {
  return toPermission(await Notifications.getPermissionsAsync());
}

export async function requestPushPermission(): Promise<PushPermission> {
  await ensureChannel();
  return toPermission(await Notifications.requestPermissionsAsync());
}

/** El `projectId` de EAS sale de la config; sin él, Expo no puede emitir el token. */
function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/** Registra el token de este dispositivo en la cuenta. Lanza si Expo o la API fallan. */
export async function registerDevice(): Promise<void> {
  await ensureChannel();
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
  await registerPushToken(data);
}

/**
 * Si el permiso ya está dado, vuelve a registrar el token sin preguntar nada. Se llama al
 * entrar: el token puede haber cambiado o venir de otra cuenta en el mismo teléfono.
 */
export async function syncPushToken(): Promise<void> {
  if ((await getPushPermission()) !== "granted") return;
  await registerDevice();
}

import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";
import { notificationRoute } from "./routes";
import { syncPushToken } from "./push";

function isTap(response: Notifications.NotificationResponse | null) {
  return response?.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER;
}

function open(response: Notifications.NotificationResponse) {
  const route = notificationRoute(response.notification.request.content.data);
  if (route) router.push(route);
}

/**
 * Con la sesión abierta: re-registra el token si ya hay permiso y abre la pantalla de cada
 * aviso que se toca, también el que abrió la app desde cerrada.
 */
export function useNotifications(): void {
  useEffect(() => {
    // Sin permiso o sin red, se reintenta en la próxima sesión; nada que mostrar acá.
    syncPushToken().catch(() => undefined);
  }, []);

  useEffect(() => {
    // El aviso que abrió la app puede llegar también por el listener: esa única repetición
    // se descarta. Los toques siguientes, aunque sean del mismo aviso, navegan.
    let launch: string | null = null;
    const last = Notifications.getLastNotificationResponse();
    if (last && isTap(last)) {
      launch = last.notification.request.identifier;
      Notifications.clearLastNotificationResponse();
      open(last);
    }

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (!isTap(response)) return;
      if (response.notification.request.identifier === launch) {
        launch = null;
        return;
      }
      open(response);
    });
    return () => subscription.remove();
  }, []);
}

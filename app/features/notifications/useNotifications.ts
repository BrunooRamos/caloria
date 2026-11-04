import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { notificationRoute } from "./routes";
import { syncPushToken } from "./push";

/**
 * Con la sesión abierta: re-registra el token si ya hay permiso y abre la pantalla de cada
 * aviso que se toca, también el que abrió la app desde cerrada.
 */
export function useNotifications(): void {
  const handled = useRef<string | null>(null);

  useEffect(() => {
    // Sin permiso o sin red, se reintenta en la próxima sesión; nada que mostrar acá.
    syncPushToken().catch(() => undefined);
  }, []);

  useEffect(() => {
    function open(response: Notifications.NotificationResponse | null) {
      if (response?.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      // El aviso que abrió la app puede llegar por las dos vías.
      const { identifier, content } = response.notification.request;
      if (handled.current === identifier) return;
      handled.current = identifier;
      Notifications.clearLastNotificationResponse();
      const route = notificationRoute(content.data);
      if (route) router.push(route);
    }

    open(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, []);
}

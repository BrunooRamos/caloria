import { Screen } from "@/components";
import { MeFallback } from "./MeFallback";
import { NotificationsSection } from "./NotificationsSection";
import { useMe } from "./useMe";

/** Avisos: el permiso de este teléfono y qué avisos recibir. */
export default function NotificationsScreen() {
  const { state, reload, saveNotifications } = useMe();
  return (
    <Screen scroll edges={["bottom", "left", "right"]}>
      {state.status === "ready" ? (
        <NotificationsSection notifications={state.me.notifications} save={saveNotifications} />
      ) : (
        <MeFallback state={state} onRetry={reload} />
      )}
    </Screen>
  );
}

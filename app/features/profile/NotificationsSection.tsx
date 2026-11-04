import { useEffect, useRef, useState } from "react";
import { AppState, Linking, StyleSheet, View } from "react-native";
import { Button, Card, FormError, SwitchRow, Text } from "@/components";
import {
  getPushPermission,
  registerDevice,
  requestPushPermission,
} from "@/features/notifications/push";
import type { PushPermission } from "@/features/notifications/push";
import { errorMessage } from "@/services/error-messages";
import type { NotificationPreferences, NotificationType } from "@/services/users";
import { spacing } from "@/theme";
import { NOTIFICATION_OPTIONS } from "./options";

const REGISTER_FAILED = "No pudimos activar los avisos en este teléfono. Probá de nuevo más tarde.";

interface NotificationsSectionProps {
  notifications: NotificationPreferences;
  save(changes: Partial<NotificationPreferences>): Promise<void>;
}

/** Permiso del teléfono y qué avisos recibir. Cada interruptor se guarda al tocarlo. */
export function NotificationsSection({ notifications, save }: NotificationsSectionProps) {
  const [pending, setPending] = useState<Partial<NotificationPreferences> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function toggle(type: NotificationType, value: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending({ [type]: value });
    setError(null);
    try {
      await save({ [type]: value });
    } catch (err) {
      // Sin `pending` vuelve a mostrarse lo guardado.
      setError(errorMessage(err));
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  const values = { ...notifications, ...pending };

  return (
    <View style={styles.section}>
      <Text variant="h2" accessibilityRole="header">
        Avisos
      </Text>
      <Text variant="small" color="inkMuted">
        Elegí qué avisos querés recibir. Se guarda apenas lo tocás.
      </Text>
      <DevicePermission />
      <View style={styles.list}>
        {NOTIFICATION_OPTIONS.map((option) => (
          <SwitchRow
            key={option.value}
            label={option.label}
            description={option.description}
            value={values[option.value]}
            onChange={(value) => void toggle(option.value, value)}
            disabled={pending !== null}
          />
        ))}
      </View>
      <FormError message={error} />
    </View>
  );
}

/** Pide el permiso del sistema y registra el token de este teléfono. */
function DevicePermission() {
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const known = useRef<PushPermission | null>(null);
  // El diálogo del sistema pasa la app a segundo plano: mientras se pregunta, registra `ask`.
  const prompting = useRef(false);

  useEffect(() => {
    let active = true;
    function check() {
      void getPushPermission()
        .catch((): PushPermission => "undetermined")
        .then((next) => {
          if (!active || prompting.current) return;
          const previous = known.current;
          known.current = next;
          // Lo activó desde la configuración del teléfono: falta registrar el token.
          if (previous !== null && previous !== "granted" && next === "granted") {
            registerDevice().catch(() => setError(REGISTER_FAILED));
          }
          setPermission(next);
        });
    }
    check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  async function ask() {
    prompting.current = true;
    setAsking(true);
    setError(null);
    try {
      const next = await requestPushPermission();
      known.current = next;
      setPermission(next);
      if (next === "granted") await registerDevice();
    } catch {
      setError(REGISTER_FAILED);
    } finally {
      prompting.current = false;
      setAsking(false);
    }
  }

  if (permission === null) return null;

  if (permission === "granted") {
    return (
      <>
        <Text variant="small" color="sageText">
          Los avisos están activados en este teléfono.
        </Text>
        <FormError message={error} />
      </>
    );
  }

  const blocked = permission === "blocked";
  return (
    <Card>
      <Text variant="h3">Activá los avisos en este teléfono</Text>
      <Text variant="small" color="inkMuted">
        {blocked
          ? "Los avisos están bloqueados. Podés activarlos en la configuración del sistema, en los permisos de CalorIA."
          : "Te avisamos cuando tu comida esté lista, si tu racha está en riesgo y cuando llegue tu resumen semanal."}
      </Text>
      {blocked ? (
        <Button
          variant="secondary"
          title="Abrir configuración"
          onPress={() => void Linking.openSettings()}
        />
      ) : (
        <Button title="Activar avisos" loading={asking} onPress={() => void ask()} />
      )}
      <FormError message={error} />
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  list: { gap: spacing.xs, marginTop: spacing.xs },
});

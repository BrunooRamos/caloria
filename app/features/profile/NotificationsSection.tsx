import { useCallback, useEffect, useRef, useState } from "react";
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

const REGISTER_FAILED = "No pudimos activar los avisos en este teléfono. Probá de nuevo.";

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
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const known = useRef<PushPermission | null>(null);
  // El último registro falló: al volver a la app se reintenta aunque el permiso no cambió.
  const failed = useRef(false);
  // El diálogo del sistema pasa la app a segundo plano: mientras se pregunta, registra `ask`.
  const prompting = useRef(false);

  const register = useCallback(async () => {
    setRegistering(true);
    setError(null);
    try {
      await registerDevice();
      failed.current = false;
    } catch {
      failed.current = true;
      setError(REGISTER_FAILED);
    } finally {
      setRegistering(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    function check() {
      void getPushPermission()
        .catch((): PushPermission => "undetermined")
        .then((next) => {
          if (!active || prompting.current) return;
          const previous = known.current;
          known.current = next;
          // Lo activó desde la configuración del teléfono, o el registro anterior falló.
          const granted = previous !== null && previous !== "granted" && next === "granted";
          if (granted || (next === "granted" && failed.current)) void register();
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
  }, [register]);

  async function ask() {
    prompting.current = true;
    setAsking(true);
    setError(null);
    try {
      const next = await requestPushPermission();
      known.current = next;
      setPermission(next);
      if (next === "granted") await register();
    } catch {
      setError(REGISTER_FAILED);
    } finally {
      prompting.current = false;
      setAsking(false);
    }
  }

  if (permission === null) return null;

  if (permission === "granted") {
    return error ? (
      <Card>
        <FormError message={error} />
        <Button
          variant="secondary"
          title="Reintentar"
          loading={registering}
          onPress={() => void register()}
        />
      </Card>
    ) : (
      <Text variant="small" color="sageText" accessibilityLiveRegion="polite">
        {registering ? "Activando los avisos…" : "Los avisos están activados en este teléfono."}
      </Text>
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

import { StyleSheet, View } from "react-native";
import { Button, ProgressBar, Sheet, Text } from "@/components";
import { spacing } from "@/theme";
import { isBillingEnabled } from "./billingEnabled";
import type { QuotaView } from "./planView";

export interface QuotaSheetProps {
  /** Lo que dice; se mantiene mientras la hoja se cierra. */
  view: QuotaView | null;
  visible: boolean;
  onClose: () => void;
  onSeePlans: () => void;
}

/**
 * Sin análisis en el mes, en vez de la cámara: igual que la tarjeta de Tu plan, en los colores de
 * siempre. "Ver planes" y "Cerrar" quedan a la vista, del mismo tamaño.
 *
 * Sin pagos (build de Google Play) solo dice cuándo se renuevan y deja "Cerrar".
 */
export function QuotaSheet({ view, visible, onClose, onSeePlans }: QuotaSheetProps) {
  if (!isBillingEnabled()) {
    return (
      <Sheet visible={visible} onClose={onClose}>
        {view && (
          <>
            <Text>{view.renewal}</Text>
            <View style={styles.actions}>
              <Button variant="secondary" title="Cerrar" onPress={onClose} />
            </View>
          </>
        )}
      </Sheet>
    );
  }
  return (
    <Sheet visible={visible} onClose={onClose}>
      {view && (
        <>
          <Text variant="h2" color="primary" accessibilityRole="header">
            {view.title}
          </Text>
          {view.usage && <ProgressBar progress={view.usage.used / view.usage.limit} />}
          <Text color="inkMuted">{view.message}</Text>
          <View style={styles.actions}>
            <Button title="Ver planes" onPress={onSeePlans} />
            <Button variant="secondary" title="Cerrar" onPress={onClose} />
          </View>
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm, marginTop: spacing.sm },
});

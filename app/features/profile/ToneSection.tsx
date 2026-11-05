import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FormError, OptionGroup, Text, useToast } from "@/components";
import { errorMessage } from "@/services/error-messages";
import type { Tone } from "@/services/users";
import { spacing } from "@/theme";
import { TONE_OPTIONS } from "./options";

interface ToneSectionProps {
  tone: Tone;
  save(tone: Tone): Promise<void>;
}

/** Se guarda al elegir, aparte del formulario del perfil. */
export function ToneSection({ tone, save }: ToneSectionProps) {
  const [pending, setPending] = useState<Tone | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const inFlight = useRef(false);

  async function choose(value: string) {
    if (inFlight.current || value === tone) return;
    inFlight.current = true;
    setPending(value as Tone);
    setError(null);
    try {
      await save(value as Tone);
      toast("Guardamos tu elección. Se usa desde tu próximo análisis.");
    } catch (err) {
      // Sin `pending` vuelve a mostrarse el tono guardado.
      setError(errorMessage(err));
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  const saving = pending !== null;

  return (
    <View style={styles.section}>
      <Text variant="small" color="inkMuted">
        Elegí cómo te hablamos después de cada análisis. Se guarda apenas lo elegís.
      </Text>
      <View style={styles.group}>
        <OptionGroup
          label="Tono del comentario"
          options={TONE_OPTIONS}
          value={pending ?? tone}
          onChange={(value) => void choose(value)}
          disabled={saving}
        />
      </View>
      {saving && (
        <Text variant="small" color="inkMuted" accessibilityLiveRegion="polite">
          Guardando tu elección…
        </Text>
      )}
      <FormError message={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  group: { marginVertical: spacing.sm },
});

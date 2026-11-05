import * as ImagePicker from "expo-image-picker";
import { router, usePreventRemove } from "expo-router";
import { useState } from "react";
import { confirmAction } from "@/components";
import { CameraStep } from "./CameraStep";
import { preparePhoto } from "./prepare-photo";
import type { PreparedPhoto } from "./prepare-photo";
import { PreviewStep } from "./PreviewStep";
import { useAudioNote } from "./useAudioNote";

/**
 * Registrar una comida. Cámara y vista previa son estados de la misma pantalla, así
 * "Sacar otra" no navega y al enviar se reemplaza la captura entera por el resultado.
 * El audio vive acá y no en la vista previa: cuenta la preparación, no la foto, así que
 * sobrevive a "Sacar otra".
 */
export default function CaptureScreen() {
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const audio = useAudioNote();

  const disablePrevention = usePreventRemove(
    (sending || audio.note !== null) && !leaving,
    ({ repeat }) => {
      if (sending) return;
      void confirmAction({
        title: photo ? "¿Descartar la foto y el audio?" : "¿Descartar el audio?",
        message: "Si cerrás ahora, no se guardan.",
        confirmTitle: "Descartar",
      }).then((discard) => {
        if (!discard) return;
        audio.stopPlayback();
        setLeaving(true);
        repeat();
      });
    },
  );

  async function handlePhoto(uri: string) {
    setPreparing(true);
    setError(null);
    try {
      setPhoto(await preparePhoto(uri));
    } catch {
      setError("No pudimos procesar la foto. Probá con otra.");
    } finally {
      setPreparing(false);
    }
  }

  async function pickFromGallery() {
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
      });
      const asset = result.canceled ? undefined : result.assets[0];
      if (asset) await handlePhoto(asset.uri);
    } catch {
      setError("No pudimos abrir la galería. Probá de nuevo.");
    }
  }

  function showResult(mealId: string, photoUri: string) {
    setLeaving(true);
    disablePrevention();
    router.replace({ pathname: "/meals/[id]", params: { id: mealId, photoUri } });
  }

  if (photo) {
    return (
      <PreviewStep
        photo={photo}
        audio={audio}
        onSendingChange={setSending}
        onSent={showResult}
        onRetake={() => {
          audio.stopPlayback();
          setPhoto(null);
        }}
        onClose={() => router.back()}
      />
    );
  }
  return (
    <CameraStep
      busy={preparing}
      error={error}
      onPhoto={handlePhoto}
      onPickFromGallery={pickFromGallery}
      onClose={() => router.back()}
    />
  );
}

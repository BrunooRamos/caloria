import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { colors, radius } from "@/theme";

export interface MealPhotoProps {
  /** La foto que dejó la captura: aparece al instante, sin esperar al servidor. */
  localUri?: string;
  /** `photoUrl` firmada del servidor; vence a los 15 min. */
  remoteUrl?: string;
  onRemoteError(url: string): void;
}

export function MealPhoto({ localUri, remoteUrl, onRemoteError }: MealPhotoProps) {
  const [localFailed, setLocalFailed] = useState(false);
  const uri = localUri && !localFailed ? localUri : remoteUrl;

  if (!uri) return <View style={styles.photo} />;
  return (
    <Image
      source={{ uri }}
      resizeMode="cover"
      accessibilityLabel="Foto de tu comida"
      style={styles.photo}
      onError={() => (uri === localUri ? setLocalFailed(true) : onRemoteError(uri))}
    />
  );
}

const styles = StyleSheet.create({
  photo: { aspectRatio: 4 / 3, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt },
});

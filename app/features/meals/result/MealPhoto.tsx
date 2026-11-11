import { ImageOff } from "lucide-react-native";
import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { Button, Text } from "@/components";
import { colors, radius, sizes, spacing } from "@/theme";

export interface MealPhotoProps {
  localUri?: string;
  remoteUrl?: string;
  onRemoteError(url: string): void;
  onRetry(): void;
}

export function MealPhoto({ localUri, remoteUrl, onRemoteError, onRetry }: MealPhotoProps) {
  const [localFailed, setLocalFailed] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const uri = localUri && !localFailed ? localUri : remoteUrl;

  if (!uri) return <View style={styles.photo} />;
  if (uri === failedUrl) {
    return (
      <View style={[styles.photo, styles.failed]} accessibilityLiveRegion="polite">
        <ImageOff color={colors.inkMuted} size={sizes.icon} strokeWidth={sizes.iconStroke} />
        <Text variant="small" color="inkMuted" style={styles.message}>
          No pudimos cargar la foto.
        </Text>
        <Button
          variant="secondary"
          title="Reintentar"
          accessibilityLabel="Reintentar cargar la foto"
          onPress={() => {
            setFailedUrl(null);
            onRetry();
          }}
        />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      resizeMode="cover"
      accessibilityLabel="Foto de tu comida"
      style={styles.photo}
      onError={() => {
        if (uri === localUri) {
          setLocalFailed(true);
          return;
        }
        setFailedUrl(uri);
        onRemoteError(uri);
      }}
    />
  );
}

const styles = StyleSheet.create({
  photo: { aspectRatio: 4 / 3, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt },
  failed: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  message: { textAlign: "center" },
});

import { CameraView, useCameraPermissions } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import { Images, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FormError, HeaderButton, IconButton, Text } from "@/components";
import { borderWidth, colors, opacity, radius, sizes, spacing } from "@/theme";
import { PermissionStep } from "./PermissionStep";

export interface CameraStepProps {
  busy: boolean;
  error: string | null;
  onPhoto(uri: string): void;
  onPickFromGallery(): void;
  onClose(): void;
}

export function CameraStep({ busy, error, onPhoto, onPickFromGallery, onClose }: CameraStepProps) {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  useEffect(() => {
    if (permission?.status === "undetermined" && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void getPermission();
    });
    return () => subscription.remove();
  }, [getPermission]);

  if (permission && !permission.granted && permission.status !== "undetermined") {
    return (
      <PermissionStep
        canAskAgain={permission.canAskAgain}
        onRequest={() => void requestPermission()}
        onPickFromGallery={onPickFromGallery}
        onClose={onClose}
      />
    );
  }

  async function takePicture() {
    if (!camera.current || capturing) return;
    setCapturing(true);
    setCaptureError(null);
    try {
      const picture = await camera.current.takePictureAsync({ exif: false });
      onPhoto(picture.uri);
    } catch {
      setCaptureError("No pudimos sacar la foto. Probá de nuevo.");
    } finally {
      setCapturing(false);
    }
  }

  const shutterDisabled = !ready || busy || capturing;
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {permission?.granted && !unavailable && (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          onCameraReady={() => setReady(true)}
          onMountError={() => setUnavailable(true)}
        />
      )}
      <SafeAreaView style={styles.overlay}>
        <View style={styles.top}>
          <HeaderButton icon={X} title="Cerrar" variant="camera" onPress={onClose} />
        </View>

        <View style={styles.middle}>
          {unavailable && (
            <Text color="onCamera" style={styles.centered}>
              No pudimos abrir la cámara. Podés elegir una foto de la galería.
            </Text>
          )}
          {busy && (
            <ActivityIndicator color={colors.onCamera} accessibilityLabel="Preparando foto" />
          )}
        </View>

        <View style={styles.bottom}>
          <FormError message={error ?? captureError} />
          <View style={styles.controls}>
            <IconButton
              icon={Images}
              label="Elegir de la galería"
              caption="Galería"
              variant="camera"
              disabled={busy}
              onPress={onPickFromGallery}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sacar foto"
              accessibilityState={{ disabled: shutterDisabled, busy: capturing }}
              disabled={shutterDisabled}
              onPress={takePicture}
              style={({ pressed }) => [
                styles.shutter,
                pressed && styles.pressed,
                shutterDisabled && styles.disabled,
              ]}
            >
              <View style={styles.shutterInner} />
            </Pressable>
            <View style={styles.slot} />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cameraBackground },
  overlay: { flex: 1 },
  top: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  middle: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  centered: { textAlign: "center" },
  bottom: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  shutter: {
    width: sizes.shutter,
    height: sizes.shutter,
    borderRadius: radius.full,
    borderWidth: borderWidth.shutter,
    borderColor: colors.onCamera,
    padding: spacing.xxs,
  },
  shutterInner: { flex: 1, borderRadius: radius.full, backgroundColor: colors.onCamera },
  slot: { width: sizes.touchTarget },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
});

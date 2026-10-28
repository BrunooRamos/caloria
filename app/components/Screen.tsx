import { StatusBar } from "expo-status-bar";
import type { PropsWithChildren, ReactElement, ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import type { RefreshControlProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Edge } from "react-native-safe-area-context";
import { colors, spacing } from "@/theme";
import { ToneContext } from "./tone";
import type { SurfaceTone } from "./tone";

export interface ScreenProps extends PropsWithChildren {
  scroll?: boolean;
  edges?: Edge[];
  tone?: SurfaceTone;
  /** Pull to refresh; solo con `scroll`. */
  refreshControl?: ReactElement<RefreshControlProps>;
  /** Fijo abajo, fuera del scroll, como el botón de guardar de un formulario largo. Solo con `scroll`. */
  footer?: ReactNode;
}

export function Screen({
  children,
  scroll = false,
  edges,
  tone = "default",
  refreshControl,
  footer,
}: ScreenProps) {
  const root = [styles.root, tone === "brand" ? styles.brand : styles.default];
  const statusBar = tone === "brand" ? <StatusBar style="light" /> : null;
  const content = <ToneContext value={tone}>{children}</ToneContext>;

  if (!scroll) {
    return (
      <SafeAreaView edges={edges} style={[root, styles.content]}>
        {statusBar}
        {content}
      </SafeAreaView>
    );
  }

  const scrollView = (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      refreshControl={refreshControl}
      contentContainerStyle={[styles.content, styles.grow]}
    >
      {content}
    </ScrollView>
  );
  const body = (
    <>
      {scrollView}
      {footer ? (
        <View style={styles.footer}>
          <ToneContext value={tone}>{footer}</ToneContext>
        </View>
      ) : null}
    </>
  );

  return (
    <SafeAreaView edges={edges} style={root}>
      {statusBar}
      {Platform.OS === "ios" ? (
        body
      ) : (
        <KeyboardAvoidingView behavior="padding" style={styles.root}>
          {body}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  default: { backgroundColor: colors.background },
  brand: { backgroundColor: colors.primary },
  content: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
  grow: { flexGrow: 1 },
  footer: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});

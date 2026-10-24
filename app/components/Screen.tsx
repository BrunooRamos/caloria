import { StatusBar } from "expo-status-bar";
import type { PropsWithChildren } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Edge } from "react-native-safe-area-context";
import { colors, spacing } from "@/theme";
import { ToneContext } from "./tone";
import type { SurfaceTone } from "./tone";

export interface ScreenProps extends PropsWithChildren {
  scroll?: boolean;
  edges?: Edge[];
  tone?: SurfaceTone;
}

export function Screen({ children, scroll = false, edges, tone = "default" }: ScreenProps) {
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
      contentContainerStyle={[styles.content, styles.grow]}
    >
      {content}
    </ScrollView>
  );

  return (
    <SafeAreaView edges={edges} style={root}>
      {statusBar}
      {Platform.OS === "ios" ? (
        scrollView
      ) : (
        <KeyboardAvoidingView behavior="padding" style={styles.root}>
          {scrollView}
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
});

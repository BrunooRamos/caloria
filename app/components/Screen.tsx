import { StatusBar } from "expo-status-bar";
import { createContext, use, useCallback, useRef } from "react";
import type { PropsWithChildren, ReactElement, ReactNode } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import type { RefreshControlProps, ScrollViewInstance, ViewInstance } from "react-native";
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

type RevealInScroll = (target: ViewInstance | null) => void;
const RevealContext = createContext<RevealInScroll | null>(null);

export function useRevealInScroll(): RevealInScroll | null {
  return use(RevealContext);
}

export function Screen({
  children,
  scroll = false,
  edges,
  tone = "default",
  refreshControl,
  footer,
}: ScreenProps) {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrollY = useRef(0);
  const reveal = useCallback<RevealInScroll>((target) => {
    const scroll = scrollRef.current?.getNativeScrollRef();
    if (!target || !scroll) return;
    scroll.measureInWindow((_sx, scrollTop, _sw, scrollHeight) => {
      target.measureInWindow((_x, top, _width, height) => {
        // Lo visible termina donde empieza el teclado o donde termina el scroll (arriba del footer).
        const keyboardTop = Keyboard.isVisible() ? Keyboard.metrics()?.screenY : undefined;
        const visibleBottom = Math.min(scrollTop + scrollHeight, keyboardTop ?? Infinity);
        const hidden = top + height + spacing.md - visibleBottom;
        if (hidden > 0) {
          scrollRef.current?.scrollTo({ y: scrollY.current + hidden, animated: true });
        }
      });
    });
  }, []);
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
      ref={scrollRef}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      refreshControl={refreshControl}
      scrollEventThrottle={16}
      onScroll={(event) => {
        scrollY.current = event.nativeEvent.contentOffset.y;
      }}
      contentContainerStyle={[styles.content, styles.grow]}
    >
      <RevealContext value={reveal}>{content}</RevealContext>
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

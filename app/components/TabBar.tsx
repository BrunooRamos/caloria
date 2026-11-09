import type { BottomTabBarProps, BottomTabNavigationOptions } from "expo-router/tabs";
import type { LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { colors, opacity, radius, shadow, sizes, spacing } from "@/theme";
import { HEADER_MAX_FONT_SCALE } from "./HeaderButton";
import { Text } from "./Text";

/** La acción del medio, que no es una pestaña: abre una pantalla encima (registrar comida). */
export interface TabBarAction {
  icon: LucideIcon;
  title: string;
  onPress(): void;
}

export interface TabBarProps extends BottomTabBarProps {
  action?: TabBarAction;
}

/** `tabBarIcon` de cada pestaña a partir de un ícono de lucide. */
export function tabIcon(Icon: LucideIcon): BottomTabNavigationOptions["tabBarIcon"] {
  return function TabIcon({ color }) {
    return <Icon color={color} size={sizes.icon} strokeWidth={sizes.iconStroke} />;
  };
}

/**
 * Barra de pestañas de abajo: ícono y texto en cada una, la activa con fondo `sageSoft` y en
 * `primary`. La acción del medio va destacada en un círculo `primary` que sobresale de la barra.
 */
export function TabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
  insets,
  action,
}: TabBarProps) {
  const tabs = state.routes.map((route, index) => {
    const { options } = descriptors[route.key];
    const focused = state.index === index;
    const title = typeof options.title === "string" ? options.title : route.name;
    const color = focused ? colors.primary : colors.inkMuted;

    function onPress() {
      const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) navigateToTab(route.key);
    }

    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityLabel={title}
        accessibilityState={{ selected: focused }}
        testID={`tab-${route.name}`}
        onPress={onPress}
        style={({ pressed }) => [styles.item, pressed && styles.pressed]}
      >
        <View style={[styles.icon, focused && styles.iconFocused]}>
          {options.tabBarIcon?.({ focused, color, size: sizes.icon })}
        </View>
        <Label title={title} focused={focused} />
      </Pressable>
    );
  });

  if (action) {
    const { icon: Icon, title, onPress } = action;
    tabs.splice(
      Math.ceil(tabs.length / 2),
      0,
      <Pressable
        key="action"
        accessibilityRole="button"
        accessibilityLabel={title}
        testID="tab-action"
        onPress={onPress}
        style={({ pressed }) => [styles.item, pressed && styles.pressed]}
      >
        <View style={styles.action}>
          <Icon color={colors.onPrimary} size={sizes.icon} strokeWidth={sizes.iconStroke} />
        </View>
        <Label title={title} focused />
      </Pressable>,
    );
  }

  return (
    <View
      accessibilityRole="tabbar"
      style={[
        styles.bar,
        {
          paddingBottom: insets.bottom + spacing.xxs,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      {tabs}
    </View>
  );
}

function Label({ title, focused }: { title: string; focused: boolean }) {
  return (
    <Text
      variant="caption"
      color={focused ? "primary" : "inkMuted"}
      numberOfLines={1}
      adjustsFontSizeToFit
      maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}
    >
      {title}
    </Text>
  );
}

const ICON_HEIGHT = sizes.icon + spacing.xs;

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
  },
  item: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xxs,
    minHeight: sizes.touchTarget,
    paddingHorizontal: spacing.xxs,
  },
  icon: {
    height: ICON_HEIGHT,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  iconFocused: { backgroundColor: colors.sageSoft },
  action: {
    width: sizes.control,
    height: sizes.control,
    marginTop: ICON_HEIGHT - sizes.control,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.float,
  },
  pressed: { opacity: opacity.pressed },
});

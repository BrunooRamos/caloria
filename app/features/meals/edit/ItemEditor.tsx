import { X } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { Card, IconButton, Input, Text, TextButton } from "@/components";
import { colors, radius, sizes, spacing, typography } from "@/theme";
import { nameKey, rangeKey } from "./draft";
import type { ItemDraft, RangePath } from "./draft";
import { RangeField } from "./RangeField";
import type { MealEditor } from "./useMealEditor";
import { ITEM_NAME_MAX_CHARS } from "./validation";

const PARTS = [
  // Cortos: cada uno va en media card y tiene que entrar en un iPhone SE.
  { part: "grams", label: "Gramos", of: "Gramos de", placeholder: "Ej.: 120 g" },
  { part: "kcal", label: "Kcal", of: "Kcal de", placeholder: "Ej.: 300" },
] as const;

export function ItemEditor({ item, editor }: { item: ItemDraft; editor: MealEditor }) {
  const editable = !editor.saving;
  // El nombre escrito puede estar vacío; para leerlo en voz alta sirve el que tenía.
  const name = item.name.trim() || item.original?.name || "ingrediente nuevo";

  return (
    <Card>
      <View style={styles.name}>
        <View style={styles.grow}>
          <Input
            label="Ingrediente"
            placeholder="Ej.: arroz"
            wrap
            accessibilityLabel={`Nombre de ${name}`}
            value={item.name}
            maxLength={ITEM_NAME_MAX_CHARS}
            editable={editable}
            error={editor.errors[nameKey(item.key)]}
            onChangeText={(text) => editor.setItemName(item.key, text)}
            onBlur={() => editor.blurItemName(item.key)}
          />
        </View>
        <View style={styles.remove}>
          <IconButton
            icon={X}
            label={`Quitar ${name}`}
            disabled={!editable}
            onPress={() => editor.removeItem(item.key)}
          />
        </View>
      </View>

      <View style={styles.values}>
        {PARTS.map(({ part, label, of, placeholder }) => {
          const path: RangePath = { field: "items", key: item.key, part };
          return (
            <View key={part} style={styles.value}>
              <RangeField
                label={label}
                accessibilityLabel={`${of} ${name}`}
                value={item[part]}
                placeholder={placeholder}
                error={editor.errors[rangeKey(path)]}
                editable={editable}
                onChangeText={(text) => editor.setRange(path, text)}
                onBlur={() => editor.blurRange(path)}
              />
            </View>
          );
        })}
      </View>
    </Card>
  );
}

/** Lo que queda en lugar de un ingrediente quitado, hasta guardar. */
export function RemovedItem({ item, editor }: { item: ItemDraft; editor: MealEditor }) {
  const name = item.name.trim() || item.original?.name || "el ingrediente nuevo";
  return (
    <View style={styles.removed} accessibilityLiveRegion="polite">
      <Text variant="small" color="inkMuted" style={styles.grow}>
        Quitaste {name}
      </Text>
      <TextButton
        title="Deshacer"
        accessibilityLabel={`Deshacer: volver a agregar ${name}`}
        disabled={editor.saving}
        onPress={() => editor.undoRemove(item.key)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  name: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs },
  grow: { flex: 1 },
  // Centrado con el campo, que arranca debajo del label.
  remove: {
    marginTop:
      typography.smallStrong.lineHeight + spacing.xs + (sizes.control - sizes.touchTarget) / 2,
    marginRight: -spacing.xs,
  },
  values: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  value: { flexGrow: 1, flexBasis: "40%" },
  removed: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
});

import { X } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { Card, IconButton, Input, Text, TextButton } from "@/components";
import { colors, radius, sizes, spacing, typography } from "@/theme";
import { errorKey, nameKey } from "./draft";
import type { ItemDraft, RangePath } from "./draft";
import { RangeField } from "./RangeField";
import type { MealEditor } from "./useMealEditor";
import { ITEM_NAME_MAX_CHARS } from "./validation";

const PARTS = [
  { part: "grams", label: "Gramos", unit: "g", of: "Gramos de" },
  { part: "kcal", label: "Kcal", unit: "kcal", of: "Kcal de" },
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
        {PARTS.map(({ part, label, unit, of }) => {
          const path: RangePath = { field: "items", key: item.key, part };
          const draft = item[part];
          return (
            <View key={part} style={[styles.value, draft.mode === "range" && styles.full]}>
              <RangeField
                label={label}
                unit={unit}
                accessibilityLabel={`${of} ${name}`}
                draft={draft}
                current={item.original?.[part]}
                errors={{
                  value: editor.errors[errorKey(path, "value")],
                  min: editor.errors[errorKey(path, "min")],
                  max: editor.errors[errorKey(path, "max")],
                }}
                editable={editable}
                onChange={(next) => editor.setRange(path, next)}
                onToggle={() => editor.toggleRange(path, item.original?.[part])}
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
  full: { flexBasis: "100%" },
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

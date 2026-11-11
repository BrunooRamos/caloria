import { useLocalSearchParams, usePreventRemove } from "expo-router";
import { Hourglass } from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  Button,
  FormError,
  Input,
  Notice,
  Screen,
  Skeleton,
  Text,
  confirmAction,
  goBack,
  useToast,
} from "@/components";
import { ApiError } from "@/services/api-error";
import { errorMessage } from "@/services/error-messages";
import { correctMeal, getMeal } from "@/services/meals";
import type { Meal, MealValues, ReadyMeal } from "@/services/meals";
import { useCachedMeal, useMealCache } from "@/store/meals";
import { sizes, spacing, typography } from "@/theme";
import { formatRange } from "./format";
import { MACRO_KEYS, isManual, rangeKey } from "./edit/draft";
import type { MacroKey, RangePath } from "./edit/draft";
import { keepPhoto } from "./edit/correction";
import { ItemEditor, RemovedItem } from "./edit/ItemEditor";
import { formatRangeInput } from "./edit/parse-range";
import { RangeField } from "./edit/RangeField";
import { useMealEditor } from "./edit/useMealEditor";
import { DISH_MAX_CHARS, ITEMS_MAX } from "./edit/validation";
import { NotFoundState } from "./result/FailedState";

const MACROS: Record<MacroKey, { label: string; placeholder: string }> = {
  protein: { label: "Proteínas (g)", placeholder: "40 o 35-45" },
  carbs: { label: "Carbohidratos (g)", placeholder: "60 o 50-70" },
  fat: { label: "Grasas (g)", placeholder: "30 o 25-35" },
};

/** Corregir una comida lista: plato, ingredientes, kcal y macros (RF-06). */
export default function MealEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { meal, error, retry } = useMealToEdit(id);

  let content;
  if (meal?.status === "ready") return <MealEditForm meal={meal} />;
  if (error instanceof ApiError && error.status === 404) content = <NotFoundState />;
  else if (error) {
    content = (
      <>
        <FormError message={errorMessage(error)} />
        <Button variant="secondary" title="Reintentar" onPress={retry} />
      </>
    );
  } else if (meal) {
    content = (
      <Notice
        icon={Hourglass}
        title="Todavía no se puede corregir"
        detail={
          meal.status === "processing"
            ? "Estamos analizando esta comida. Cuando esté lista, vas a poder corregirla."
            : "Esta comida no tiene un análisis para corregir."
        }
      >
        <Button variant="secondary" title="Volver" onPress={goBack} />
      </Notice>
    );
  } else {
    content = (
      <View accessibilityLabel="Cargando la comida" style={styles.content}>
        {[0, 1, 2].map((index) => (
          <View key={index} style={styles.section}>
            <Skeleton height={typography.smallStrong.lineHeight} width="30%" />
            <Skeleton height={sizes.control} rounded="md" />
          </View>
        ))}
      </View>
    );
  }

  return (
    <Screen scroll edges={["bottom", "left", "right"]}>
      <View style={styles.content}>{content}</View>
    </Screen>
  );
}

/**
 * La comida que dejó el detalle en el store. Si se abrió directo (un link), la pide una vez: no
 * la guarda en el store, que es de las pantallas de detalle abiertas.
 */
function useMealToEdit(id: string) {
  const cached = useCachedMeal(id);
  const [fetched, setFetched] = useState<Meal | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const missing = cached === null;

  useEffect(() => {
    if (!missing) return;
    const controller = new AbortController();
    getMeal(id, controller.signal).then(setFetched, (err: unknown) => {
      if (!controller.signal.aborted) setError(err);
    });
    return () => controller.abort();
  }, [attempt, id, missing]);

  return {
    meal: cached ?? fetched,
    error: cached ? null : error,
    retry() {
      setError(null);
      setAttempt((count) => count + 1);
    },
  };
}

function MealEditForm({ meal }: { meal: ReadyMeal }) {
  const cache = useMealCache();
  const toast = useToast();
  // La comida como estaba al abrir: contra eso se compara, aunque el store se actualice.
  const [base] = useState<MealValues>(() => ({
    dish: meal.dish,
    items: meal.items,
    kcal: meal.kcal,
    macros: meal.macros,
  }));
  const [leaving, setLeaving] = useState<"saved" | "discarded" | null>(null);
  const editor = useMealEditor(base, async (body) => {
    const updated = await correctMeal(meal.id, body);
    // El detalle que la tiene abierta la muestra corregida sin pedirla de nuevo. Una corrección no
    // cambia la foto: queda la URL que ya se ve, así la imagen no se vuelve a cargar de cero con la
    // firma nueva mientras el detalle está tapado. Si vence, el detalle la renueva (onError).
    const shown = cache.get(meal.id);
    if (shown) cache.set(meal.id, keepPhoto(shown, updated));
    toast("Guardamos la corrección.");
    setLeaving("saved");
  });
  const { draft, autoTotal, errors } = editor;
  const editable = !editor.saving;

  // Con cambios sin guardar pregunta antes de salir; mientras guarda no deja salir.
  usePreventRemove((editor.changed || editor.saving) && !leaving, ({ repeat }) => {
    if (editor.saving) return;
    void confirmAction({
      title: "¿Descartar los cambios?",
      message: "Lo que corregiste no se va a guardar.",
      confirmTitle: "Descartar",
      cancelTitle: "Seguir editando",
    }).then((discard) => {
      if (!discard) return;
      setLeaving("discarded");
      repeat();
    });
  });

  // Guardada: vuelve al detalle después del render que deja de bloquear la salida.
  useEffect(() => {
    if (leaving === "saved") goBack();
  }, [leaving]);

  const active = draft.items.filter((item) => !item.removed);
  const totalPath: RangePath = { field: "kcal" };
  let totalHint: string | undefined;
  let totalAction: { title: string; onPress(): void } | undefined;
  if (autoTotal.source === "sum") {
    if (isManual(draft)) {
      totalAction = {
        title: `Usar la suma de los ingredientes: ${formatRange(autoTotal.kcal, "kcal")}`,
        onPress: editor.resetTotal,
      };
    } else {
      totalHint = "Suma de los ingredientes.";
    }
  }

  return (
    <Screen
      scroll
      edges={["bottom", "left", "right"]}
      footer={
        <>
          <FormError message={editor.formError} />
          <Button
            title="Guardar cambios"
            loading={editor.saving}
            disabled={!editor.changed}
            onPress={editor.save}
          />
        </>
      }
    >
      <View style={styles.content}>
        <Text color="inkMuted">Podés poner un número exacto o un rango si no estás seguro.</Text>

        <Input
          label="Plato"
          wrap
          value={draft.dish}
          maxLength={DISH_MAX_CHARS}
          editable={editable}
          error={errors.dish}
          onChangeText={editor.setDish}
          onBlur={editor.blurDish}
        />

        <View style={styles.section}>
          <Text variant="h3" accessibilityRole="header">
            Ingredientes
          </Text>
          {draft.items.map((item) =>
            item.removed ? (
              <RemovedItem key={item.key} item={item} editor={editor} />
            ) : (
              <ItemEditor key={item.key} item={item} editor={editor} />
            ),
          )}
          {errors.items ? <FormError message={errors.items} /> : null}
          {active.length < ITEMS_MAX && (
            <Button
              variant="secondary"
              title="Agregar ingrediente"
              disabled={!editable}
              onPress={editor.addItem}
            />
          )}
        </View>

        <View style={styles.section}>
          <Text variant="h3" accessibilityRole="header">
            Calorías y macros
          </Text>
          <RangeField
            label="Calorías totales"
            // Automático, muestra el calculado y lo sigue si cambian los ingredientes.
            value={draft.kcal ?? formatRangeInput(autoTotal.kcal)}
            placeholder="650 o 600-700"
            error={errors[rangeKey(totalPath)]}
            hint={totalHint}
            action={totalAction}
            editable={editable}
            onChangeText={(text) => editor.setRange(totalPath, text)}
            onBlur={() => editor.blurRange(totalPath)}
          />
          {MACRO_KEYS.map((macro) => {
            const path: RangePath = { field: "macros", macro };
            return (
              <RangeField
                key={macro}
                label={MACROS[macro].label}
                value={draft.macros[macro]}
                placeholder={MACROS[macro].placeholder}
                error={errors[rangeKey(path)]}
                editable={editable}
                onChangeText={(text) => editor.setRange(path, text)}
                onBlur={() => editor.blurRange(path)}
              />
            );
          })}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl },
  section: { gap: spacing.sm },
});

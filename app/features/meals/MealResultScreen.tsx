import { useIsFocused, useLocalSearchParams } from "expo-router";
import { useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Screen } from "@/components";
import { spacing } from "@/theme";
import { AnalyzingState } from "./result/AnalyzingState";
import { DeleteMeal } from "./result/DeleteMeal";
import { FailedState, NotFoundState } from "./result/FailedState";
import { MealPhoto } from "./result/MealPhoto";
import { ReadyState } from "./result/ReadyState";
import { useMealPolling } from "./useMealPolling";

/** Si la imagen sigue fallando con URLs nuevas, no se insiste más. */
const MAX_PHOTO_RENEWALS = 3;

/** Resultado de una comida: consulta el análisis hasta que está listo o falla (RF-05). */
export default function MealResultScreen() {
  const { id, photoUri } = useLocalSearchParams<{ id: string; photoUri?: string }>();
  const focused = useIsFocused();
  const polling = useMealPolling(id, { enabled: focused });
  const renewed = useRef(new Set<string>());
  const { meal } = polling;
  // Solo la foto local que dejó la captura; un link no puede hacer cargar una URL cualquiera.
  const localPhoto = photoUri?.startsWith("file:") ? photoUri : undefined;

  // La photoUrl vence a los 15 min: si no carga, se pide la comida de nuevo (una vez por URL).
  function renewPhotoUrl(failedUrl: string) {
    if (renewed.current.has(failedUrl) || renewed.current.size >= MAX_PHOTO_RENEWALS) return;
    renewed.current.add(failedUrl);
    polling.refresh();
  }

  let content;
  if (polling.notFound) content = <NotFoundState />;
  else if (meal?.status === "ready") content = <ReadyState meal={meal} />;
  else if (meal?.status === "failed") content = <FailedState code={meal.error.code} />;
  else {
    content = (
      <AnalyzingState
        slow={polling.slow}
        stalled={polling.stalled}
        connectionIssue={polling.connectionIssue}
        onRetry={polling.refresh}
      />
    );
  }

  return (
    <Screen scroll edges={["bottom", "left", "right"]}>
      <View style={styles.content}>
        <MealPhoto
          localUri={localPhoto}
          remoteUrl={meal?.photoUrl}
          onRemoteError={renewPhotoUrl}
          onRetry={polling.refresh}
        />
        {content}
        {meal && !polling.notFound && <DeleteMeal id={id} />}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl },
});

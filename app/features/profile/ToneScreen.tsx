import { Screen } from "@/components";
import { MeFallback } from "./MeFallback";
import { ToneSection } from "./ToneSection";
import { useMe } from "./useMe";

/** Comentario de tus comidas: el tono con el que se habla después de cada análisis. */
export default function ToneScreen() {
  const { state, reload, saveTone } = useMe();
  return (
    <Screen scroll edges={["bottom", "left", "right"]}>
      {state.status === "ready" ? (
        <ToneSection tone={state.me.tone} save={saveTone} />
      ) : (
        <MeFallback state={state} onRetry={reload} />
      )}
    </Screen>
  );
}

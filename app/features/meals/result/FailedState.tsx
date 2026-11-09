import { router } from "expo-router";
import { Camera, ImageOff, SearchX } from "lucide-react-native";
import { Button, Notice, goHome } from "@/components";
import { mealFailureMessage } from "@/services/error-messages";

/** Comida en `failed`: tono tranquilo y qué hacer, sin rojo (no es una alarma). */
export function FailedState({ code }: { code: string }) {
  return (
    <Notice icon={ImageOff} title="No pudimos analizar esta foto" detail={mealFailureMessage(code)}>
      <Button icon={Camera} title="Sacar otra foto" onPress={() => router.replace("/capture")} />
    </Notice>
  );
}

/** 404: la comida no existe o es de otro usuario. */
export function NotFoundState() {
  return (
    <Notice icon={SearchX} title="No encontramos esta comida" detail="Puede que se haya borrado.">
      <Button variant="secondary" title="Ir al inicio" onPress={goHome} />
    </Notice>
  );
}

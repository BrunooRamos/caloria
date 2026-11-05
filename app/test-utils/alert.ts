import { act } from "expo-router/testing-library";
import { Alert } from "react-native";
import type { AlertButton } from "react-native";

/**
 * Los diálogos del sistema (`Alert.alert`): guarda cada uno y deja tocar sus botones como lo haría
 * la persona. Si ya estaba espiado (otro test del mismo archivo), lo reusa con los llamados en cero.
 */
export function spyAlerts() {
  const alert = jest.isMockFunction(Alert.alert)
    ? jest.mocked(Alert.alert)
    : jest.spyOn(Alert, "alert");
  alert.mockClear().mockImplementation(() => undefined);
  const last = () => {
    const call = alert.mock.calls.at(-1);
    if (!call) throw new Error("No se mostró ningún diálogo");
    const [title, message, buttons = []] = call as [string, string?, AlertButton[]?];
    return { title, message, buttons };
  };
  return {
    alert,
    /** El último diálogo: título, mensaje y botones. */
    last,
    /** Toca el botón `text` del último diálogo. */
    async press(text: string) {
      const button = last().buttons.find((candidate) => candidate.text === text);
      if (!button) throw new Error(`El diálogo no tiene el botón "${text}"`);
      await act(async () => button.onPress?.());
    },
  };
}

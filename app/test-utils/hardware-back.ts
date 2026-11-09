import { act } from "expo-router/testing-library";
import { BackHandler } from "react-native";

/**
 * El botón atrás de Android, como React Native: el último listener registrado responde primero,
 * hasta que uno lo maneja. Hay que llamarlo antes de renderizar. `pressBack` devuelve si alguien
 * lo manejó: si nadie lo maneja, Android cierra la app.
 */
export function mockHardwareBack() {
  type BackListener = Parameters<typeof BackHandler.addEventListener>[1];
  const listeners: BackListener[] = [];
  const spy = jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, listener) => {
    listeners.push(listener);
    return { remove: () => listeners.splice(listeners.indexOf(listener), 1) };
  });
  async function pressBack() {
    let handled = false;
    await act(() => {
      handled = [...listeners].reverse().some((listener) => listener({} as never) === true);
    });
    return handled;
  }
  return { pressBack, spy };
}

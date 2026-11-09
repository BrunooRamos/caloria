import { Alert } from "react-native";

export interface ConfirmOptions {
  title: string;
  message: string;
  /** El botón que borra o descarta: "Eliminar", "Descartar", "Cerrar sesión". */
  confirmTitle: string;
  cancelTitle?: string;
}

/**
 * Confirmación de una acción que borra o descarta algo, con el diálogo del sistema: el patrón que la
 * gente conoce, lo cierra el atrás de Android y escala con la fuente del sistema. Resuelve `true`
 * solo si se tocó el botón de confirmar. Sin el estilo `destructive`: en iOS va en rojo y, como el
 * resto de la app, borrar o descartar no es una alarma.
 */
export function confirmAction({
  title,
  message,
  confirmTitle,
  cancelTitle = "Cancelar",
}: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelTitle, style: "cancel", onPress: () => resolve(false) },
        { text: confirmTitle, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

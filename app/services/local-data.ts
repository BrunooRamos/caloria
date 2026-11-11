import { Directory, Paths } from "expo-file-system";
import * as Notifications from "expo-notifications";

/**
 * Borra lo que la app dejó en el teléfono, además de los tokens: las fotos y los audios de la
 * cámara, las fotos achicadas para subir y las imágenes del Wrapped para compartir viven en la
 * carpeta de cache. También saca los avisos que quedaron en el centro de notificaciones. Lo usa el
 * borrado de la cuenta. No lanza: lo que no se pueda borrar lo limpia el sistema.
 */
export async function clearLocalData(): Promise<void> {
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      try {
        entry.delete();
      } catch {
        // En uso o ya borrado: se sigue con el resto.
      }
    }
  } catch {
    // Sin carpeta de cache no hay nada que borrar.
  }
  await Notifications.dismissAllNotificationsAsync().catch(() => undefined);
}

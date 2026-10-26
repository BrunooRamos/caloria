import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { targetSize } from "./resize";

/** Mismo tope que valida la API. */
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const JPEG_QUALITY = 0.8;

export interface PreparedPhoto {
  uri: string;
  width: number;
  height: number;
  /** Peso del JPEG ya comprimido; `null` si no se pudo leer (la API igual lo valida). */
  bytes: number | null;
}

/**
 * Deja la foto lista para subir: la redimensiona solo si el lado mayor pasa de 1600 px y la
 * exporta a JPEG, lo que de paso convierte las HEIC. El manipulador aplica la orientación EXIF al
 * cargarla, así que el tamaño de destino se calcula sobre la imagen como se ve.
 */
export async function preparePhoto(uri: string): Promise<PreparedPhoto> {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const target = targetSize(original);
  const image = target
    ? await ImageManipulator.manipulate(original).resize(target).renderAsync()
    : original;
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  return {
    uri: saved.uri,
    width: saved.width,
    height: saved.height,
    bytes: new File(saved.uri).size,
  };
}

export function exceedsMaxBytes({ bytes }: PreparedPhoto): boolean {
  return bytes !== null && bytes > PHOTO_MAX_BYTES;
}

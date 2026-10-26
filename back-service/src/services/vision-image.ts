import convert from "heic-convert";
import { detectPhotoType } from "@caloria/shared";

/** Formatos que acepta la IA de visión; HEIC no está. */
export type VisionImageType = "image/jpeg" | "image/png";

export interface VisionImage {
  data: Uint8Array;
  contentType: VisionImageType;
}

const HEIC_JPEG_QUALITY = 0.85;

/**
 * Deja la foto en un formato que la IA acepta: JPEG y PNG pasan tal cual, HEIC se pasa a JPEG.
 * heic-convert es libheif compilado a WASM: no necesita binarios nativos.
 */
export async function toVisionImage(photo: Uint8Array): Promise<VisionImage> {
  const type = detectPhotoType(Buffer.from(photo.buffer, photo.byteOffset, photo.byteLength));
  if (type === "image/heic") {
    const jpeg = await convert({ buffer: photo, format: "JPEG", quality: HEIC_JPEG_QUALITY });
    return { data: new Uint8Array(jpeg), contentType: "image/jpeg" };
  }
  if (type) return { data: photo, contentType: type };
  throw new Error("La foto no es JPEG, PNG ni HEIC");
}

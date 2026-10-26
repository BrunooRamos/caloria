/** La foto se sube con el lado mayor en 1600 px como máximo. */
export const MAX_PHOTO_SIDE = 1600;

export interface Size {
  width: number;
  height: number;
}

/**
 * Tamaño al que hay que llevar la foto para que el lado mayor no pase de `maxSide`, con la misma
 * proporción. `null` si ya entra: una foto chica no se agranda. Recibe el tamaño ya orientado.
 */
export function targetSize({ width, height }: Size, maxSide = MAX_PHOTO_SIDE): Size | null {
  if (!(width > 0 && height > 0)) throw new Error(`Tamaño de imagen inválido: ${width}×${height}`);
  const longest = Math.max(width, height);
  if (longest <= maxSide) return null;
  const scale = maxSide / longest;
  return width >= height
    ? { width: maxSide, height: Math.max(1, Math.round(height * scale)) }
    : { width: Math.max(1, Math.round(width * scale)), height: maxSide };
}

import { z } from "zod";
import { AppError } from "./errors";

// RF-03 y RF-04. El Front y el Backend validan lo mismo: el Backend no confía en la DMZ.
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
/** 60 s de AAC a 128 kbps son ~1 MB: el tope deja margen y acota lo que se lee para la duración. */
export const AUDIO_MAX_BYTES = 4 * 1024 * 1024;
export const AUDIO_MAX_SECONDS = 60;
export const NOTE_MAX_CHARS = 500;

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/heic"] as const;
export const AUDIO_TYPES = ["audio/mp4"] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];
export type AudioType = (typeof AUDIO_TYPES)[number];

/** Campos de archivo del multipart; cualquier otro es un 400 (`LIMIT_UNEXPECTED_FILE`). */
export const MEAL_UPLOAD_FIELDS = [
  { name: "photo", maxCount: 1 },
  { name: "audio", maxCount: 1 },
];

/**
 * Límites de multer para `POST /meals`, todo en memoria. `fileSize` es el de la foto (el mayor):
 * el del audio se controla después. Pasar cualquiera de estos límites es un 413, salvo `fieldSize`:
 * una nota larga es 400 aunque no llegue a zod.
 */
export const MEAL_UPLOAD_LIMITS = {
  fileSize: PHOTO_MAX_BYTES,
  files: MEAL_UPLOAD_FIELDS.length,
  fields: 4,
  fieldSize: NOTE_MAX_CHARS * 4,
  parts: 8,
};

export const createMealFieldsSchema = z
  .object({
    note: z
      .string()
      .trim()
      .max(NOTE_MAX_CHARS)
      .transform((note) => note || undefined)
      .optional(),
  })
  .strict();

export interface CreateMealResponse {
  mealId: string;
  status: "processing";
}

/** `:id` de las rutas de comidas: un ObjectId en hex. Otro formato es un 400 y no llega a Mongo. */
export const mealIdParamsSchema = z.object({ id: z.string().regex(/^[0-9a-f]{24}$/i) }).strict();

/** `error.code` de una comida en `failed`. La API no manda mensaje: la app lo arma con el código. */
export const MEAL_ERROR_CODES = [
  // El Back no pudo encolar el análisis (Redis caído). La comida y la media quedan para reprocesarla.
  "ENQUEUE_FAILED",
  // La IA dice que la foto no es comida. Sin reintento y no consume cupo.
  "NOT_FOOD",
  // El Worker agotó los reintentos del análisis (RNF-02).
  "ANALYSIS_FAILED",
] as const;
export type MealErrorCode = (typeof MEAL_ERROR_CODES)[number];

// RF-05: todo rango cumple min ≤ max y no tiene negativos.
export const rangeSchema = z
  .object({ min: z.number().nonnegative(), max: z.number().nonnegative() })
  .refine(({ min, max }) => min <= max, { message: "min > max" });
export type Range = z.infer<typeof rangeSchema>;

/**
 * Lo que el usuario puede corregir, con la forma del análisis. Cada clave es un campo del
 * body de `PATCH /meals/:id` y una corrección guarda su valor completo (`items`, la lista entera).
 */
export const correctableFieldsSchema = z.object({
  dish: z.string().trim().min(1),
  items: z.array(
    z.object({ name: z.string().trim().min(1), grams: rangeSchema, kcal: rangeSchema }),
  ),
  kcal: rangeSchema,
  macros: z.object({ protein: rangeSchema, carbs: rangeSchema, fat: rangeSchema }),
});
export type CorrectableFields = z.infer<typeof correctableFieldsSchema>;
export type CorrectableField = keyof CorrectableFields;

// Topes del body del PATCH. No van en correctableFieldsSchema para no ignorar correcciones ya
// guardadas; son holgados para que el usuario siempre pueda devolver lo que dijo la IA.
export const DISH_MAX_CHARS = 200;
export const ITEM_NAME_MAX_CHARS = 100;
export const ITEMS_MAX = 50;

const { dish, items, macros } = correctableFieldsSchema.shape;
const item = items.element;

/**
 * Body de `PATCH /meals/:id`: al menos un campo, cada uno completo. Un campo desconocido, en la
 * raíz, en un ingrediente o en `macros`, es un 400.
 */
export const correctMealSchema = correctableFieldsSchema
  .extend({
    dish: dish.max(DISH_MAX_CHARS),
    items: z
      .array(item.extend({ name: item.shape.name.max(ITEM_NAME_MAX_CHARS) }).strict())
      .max(ITEMS_MAX),
    macros: macros.strict(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Indicá al menos un campo" });
export type CorrectMealInput = z.infer<typeof correctMealSchema>;

interface MealResponseBase {
  id: string;
  capturedAt: string;
  /** URL GET firmada de la foto, de vida corta (RNF-04): se firma en cada request. */
  photoUrl: string;
}

export interface ProcessingMealResponse extends MealResponseBase {
  status: "processing";
}

/** Valores del análisis con las correcciones aplicadas. Sin comentario, `comment` no viene. */
export interface ReadyMealResponse extends MealResponseBase, CorrectableFields {
  status: "ready";
  confidence: number;
  comment?: { tone: string; text: string };
}

export interface FailedMealResponse extends MealResponseBase {
  status: "failed";
  error: { code: MealErrorCode };
}

/** `GET /meals/:id` y cada comida del historial. */
export type MealResponse = ProcessingMealResponse | ReadyMealResponse | FailedMealResponse;

interface Ftyp {
  major: string;
  compatible: string[];
}

/** HEIC y M4A son contenedores ISO BMFF: arrancan con una caja `ftyp` que dice qué son. */
function readFtyp(buf: Buffer): Ftyp | undefined {
  if (buf.length < 16 || buf.toString("latin1", 4, 8) !== "ftyp") return undefined;
  const size = buf.readUInt32BE(0);
  if (size < 16 || size > buf.length) return undefined;
  const compatible: string[] = [];
  for (let offset = 16; offset + 4 <= size; offset += 4) {
    compatible.push(buf.toString("latin1", offset, offset + 4));
  }
  return { major: buf.toString("latin1", 8, 12), compatible };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx"]);
// mif1/msf1 son genéricos de HEIF (también AVIF): cuentan solo si además declaran una marca HEIC.
const HEIF_BRANDS = new Set(["mif1", "msf1"]);
const AUDIO_BRANDS = new Set(["M4A ", "M4B ", "mp41", "mp42", "isom", "iso2", "3gp4"]);

/** Tipo real de la foto según sus primeros bytes; ignora extensión y Content-Type del cliente. */
export function detectPhotoType(buf: Buffer): PhotoType | undefined {
  if (buf.subarray(0, JPEG.length).equals(JPEG)) return "image/jpeg";
  if (buf.subarray(0, PNG.length).equals(PNG)) return "image/png";
  const ftyp = readFtyp(buf);
  if (!ftyp) return undefined;
  if (HEIC_BRANDS.has(ftyp.major)) return "image/heic";
  if (HEIF_BRANDS.has(ftyp.major) && ftyp.compatible.some((brand) => HEIC_BRANDS.has(brand))) {
    return "image/heic";
  }
  return undefined;
}

/** El audio que graba la app (expo-audio) es AAC en un contenedor MP4 (`.m4a`). */
export function detectAudioType(buf: Buffer): AudioType | undefined {
  const ftyp = readFtyp(buf);
  return ftyp && AUDIO_BRANDS.has(ftyp.major) ? "audio/mp4" : undefined;
}

export interface UploadedFile {
  buffer: Buffer;
  size: number;
}

export interface MealUploadInput {
  photo?: UploadedFile;
  audio?: UploadedFile;
  fields: unknown;
}

export interface ValidMealUpload {
  photo: { buffer: Buffer; contentType: PhotoType };
  audio?: { buffer: Buffer; contentType: AudioType };
  note?: string;
}

/** Valida lo que dejó multer: foto obligatoria, audio opcional y `note`. Lanza AppError. */
export function validateMealUpload({ photo, audio, fields }: MealUploadInput): ValidMealUpload {
  const { note } = createMealFieldsSchema.parse(fields ?? {});

  if (!photo) throw new AppError("VALIDATION_ERROR", "Falta la foto");
  if (photo.size > PHOTO_MAX_BYTES) throw new AppError("PAYLOAD_TOO_LARGE");
  const photoType = detectPhotoType(photo.buffer);
  if (!photoType) throw new AppError("VALIDATION_ERROR", "La foto tiene que ser JPEG, PNG o HEIC");

  let validAudio: ValidMealUpload["audio"];
  if (audio) {
    if (audio.size > AUDIO_MAX_BYTES) throw new AppError("PAYLOAD_TOO_LARGE");
    const audioType = detectAudioType(audio.buffer);
    if (!audioType) throw new AppError("VALIDATION_ERROR", "El audio tiene que ser M4A");
    validAudio = { buffer: audio.buffer, contentType: audioType };
  }

  return {
    photo: { buffer: photo.buffer, contentType: photoType },
    ...(validAudio && { audio: validAudio }),
    ...(note !== undefined && { note }),
  };
}

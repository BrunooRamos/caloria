import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AppError } from "@caloria/shared";
import type { StorageConfig } from "../config/storage";

// RNF-04: la app ve la media solo con URLs firmadas de vida corta.
export const MAX_SIGNED_URL_TTL_SECONDS = 15 * 60;

// Tope total de una subida, reintentos del SDK incluidos. Tiene que quedar por debajo del timeout
// del Front hacia el Back (BACKEND_TIMEOUT_MS, 10 s): si no, el Front responde 503 mientras el Back
// sigue intentando y puede terminar creando la comida igual.
export const UPLOAD_TIMEOUT_MS = 6_000;

export type MediaKind = "photo" | "audio";

const EXTENSIONS: Record<MediaKind, Record<string, string>> = {
  photo: { "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic" },
  audio: { "audio/mp4": "m4a", "audio/m4a": "m4a", "audio/x-m4a": "m4a" },
};

export interface UploadInput {
  userId: string;
  mealId: string;
  kind: MediaKind;
  body: Uint8Array;
  contentType: string;
}

export interface MediaService {
  /** Sube el archivo a `users/{userId}/meals/{mealId}/{kind}.{ext}` y devuelve esa key. */
  upload(input: UploadInput): Promise<string>;
  /** Idempotente: borrar una key inexistente no falla. */
  remove(key: string): Promise<void>;
  /** Borra toda la media del usuario (`DELETE /users/me`). */
  removeUserMedia(userId: string): Promise<void>;
  /** URL GET firmada; el TTL nunca supera MAX_SIGNED_URL_TTL_SECONDS. */
  signedUrl(key: string, ttlSeconds?: number): Promise<string>;
}

const userPrefix = (userId: string) => `users/${userId}/`;

export interface MediaServiceOptions {
  uploadTimeoutMs?: number;
}

export function createMediaService(
  config: StorageConfig,
  { uploadTimeoutMs = UPLOAD_TIMEOUT_MS }: MediaServiceOptions = {},
): MediaService {
  const options = {
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  };
  // La firma SigV4 incluye el host: las URLs se firman con el endpoint que alcanza la app.
  const client = new S3Client({ ...options, endpoint: config.endpoint });
  const presignClient = new S3Client({ ...options, endpoint: config.publicEndpoint });
  const Bucket = config.bucket;

  return {
    async upload({ userId, mealId, kind, body, contentType }) {
      // hasOwn: "constructor" no debe pasar la validación.
      const ext = Object.hasOwn(EXTENSIONS[kind], contentType) && EXTENSIONS[kind][contentType];
      if (!ext) throw new AppError("VALIDATION_ERROR", `Tipo de ${kind} no permitido`);
      const Key = `${userPrefix(userId)}meals/${mealId}/${kind}.${ext}`;
      await client.send(
        new PutObjectCommand({ Bucket, Key, Body: body, ContentType: contentType }),
        { abortSignal: AbortSignal.timeout(uploadTimeoutMs) },
      );
      return Key;
    },

    async remove(Key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key }));
    },

    async removeUserMedia(userId) {
      let ContinuationToken: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket, Prefix: userPrefix(userId), ContinuationToken }),
        );
        const objects = (page.Contents ?? []).map(({ Key }) => ({ Key }));
        if (objects.length > 0) {
          const { Errors } = await client.send(
            new DeleteObjectsCommand({ Bucket, Delete: { Objects: objects, Quiet: true } }),
          );
          if (Errors?.length) {
            throw new Error(`No se pudieron borrar ${Errors.length} objetos del usuario`);
          }
        }
        ContinuationToken = page.NextContinuationToken;
      } while (ContinuationToken);
    },

    signedUrl(Key, ttlSeconds = MAX_SIGNED_URL_TTL_SECONDS) {
      const expiresIn = Math.min(Math.max(1, Math.floor(ttlSeconds)), MAX_SIGNED_URL_TTL_SECONDS);
      return getSignedUrl(presignClient, new GetObjectCommand({ Bucket, Key }), { expiresIn });
    },
  };
}

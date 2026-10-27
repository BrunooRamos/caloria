import { isDeepStrictEqual } from "node:util";
import { Types } from "mongoose";
import { AppError, serializeError } from "@caloria/shared";
import type {
  CorrectableField,
  CorrectMealInput,
  CreateMealResponse,
  Logger,
  MealErrorCode,
  MealResponse,
  ValidMealUpload,
} from "@caloria/shared";
import type { MealAnalysisQueue } from "../jobs/meal-analysis";
import { MealModel } from "../models/Meal";
import type { MealMedia } from "../models/Meal";
import { UserModel } from "../models/User";
import type { User } from "../models/User";
import { localDateIn } from "./local-date";
import { applyCorrections } from "./meal-corrections";
import { MEAL_RESPONSE_FIELDS, toMealResponse } from "./meal-response";
import type { MealResponseSource } from "./meal-response";
import type { MediaKind, MediaService } from "./media";

export const ENQUEUE_FAILED = "ENQUEUE_FAILED" satisfies MealErrorCode;

const MAX_CORRECT_ATTEMPTS = 3;
const CORRECTABLE_FIELDS = [
  "dish",
  "items",
  "kcal",
  "macros",
] as const satisfies CorrectableField[];

type StoredMeal = MealResponseSource & { media: Pick<MealMedia, "photoKey"> };

export interface CorrectMealResult {
  meal: MealResponse;
  /** Campos que cambiaron y quedaron en `corrections`; vacío si no cambió nada. */
  fields: CorrectableField[];
}

export interface CreateMealContext {
  requestId: string;
  log: Logger;
}

export interface MealService {
  create(
    userId: string,
    upload: ValidMealUpload,
    context: CreateMealContext,
  ): Promise<CreateMealResponse>;
  get(userId: string, mealId: string): Promise<MealResponse>;
  correct(userId: string, mealId: string, input: CorrectMealInput): Promise<CorrectMealResult>;
}

export interface MealServiceDeps {
  media: MediaService;
  queue: MealAnalysisQueue;
  now?: () => Date;
}

export function createMealService({
  media,
  queue,
  now = () => new Date(),
}: MealServiceDeps): MealService {
  /** Best effort: si no se puede borrar, queda logueada para limpiarla a mano. */
  async function removeMedia(keys: string[], log: Logger, mealId: string) {
    const results = await Promise.allSettled(keys.map((key) => media.remove(key)));
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        log.error("no se pudo borrar media huérfana", {
          mealId,
          key: keys[i],
          err: serializeError(result.reason),
        });
      }
    });
  }

  async function uploadMedia(
    userId: string,
    mealId: string,
    { photo, audio }: ValidMealUpload,
    log: Logger,
  ): Promise<MealMedia> {
    const files: { kind: MediaKind; buffer: Buffer; contentType: string }[] = [
      { kind: "photo", ...photo },
      ...(audio ? [{ kind: "audio" as const, ...audio }] : []),
    ];
    const results = await Promise.allSettled(
      files.map(({ kind, buffer, contentType }) =>
        media.upload({ userId, mealId, kind, body: buffer, contentType }),
      ),
    );
    const uploaded = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) {
      log.error("no se pudo subir la media al bucket", {
        mealId,
        err: serializeError(failed.reason, { stack: true }),
      });
      await removeMedia(uploaded, log, mealId);
      if (failed.reason instanceof AppError) throw failed.reason;
      throw new AppError("SERVICE_UNAVAILABLE", undefined, { cause: failed.reason });
    }
    const [photoKey, audioKey] = uploaded;
    return { photoKey, ...(audioKey && { audioKey }) };
  }

  return {
    async create(userId, upload, { requestId, log }) {
      const receivedAt = now();
      const user = await UserModel.findById(userId, { "profile.timezone": 1 }).lean<
        Pick<User, "profile">
      >();
      if (!user) throw new AppError("UNAUTHORIZED");

      const mealId = new Types.ObjectId();
      const id = mealId.toString();
      const mediaKeys = await uploadMedia(userId, id, upload, log);

      try {
        await MealModel.create({
          _id: mealId,
          userId,
          capturedAt: receivedAt,
          localDate: localDateIn(user.profile.timezone, receivedAt),
          status: "processing",
          media: mediaKeys,
          ...(upload.note !== undefined && { note: upload.note }),
        });
      } catch (err) {
        log.error("no se pudo crear la comida; se borra la media subida", {
          mealId: id,
          err: serializeError(err, { stack: true }),
        });
        await removeMedia(Object.values(mediaKeys), log, id);
        throw new AppError("INTERNAL_ERROR", undefined, { cause: err });
      }

      try {
        await queue.enqueue({ mealId: id, requestId });
      } catch (err) {
        // La comida y la media quedan: se marca failed para reprocesarla cuando vuelva Redis.
        log.error("no se pudo encolar el análisis; la comida queda failed", {
          mealId: id,
          errorCode: ENQUEUE_FAILED,
          err: serializeError(err, { stack: true }),
        });
        await MealModel.updateOne(
          { _id: mealId },
          { $set: { status: "failed", error: { code: ENQUEUE_FAILED } } },
        ).catch((updateErr: unknown) => {
          log.error("no se pudo marcar la comida como failed", {
            mealId: id,
            err: serializeError(updateErr, { stack: true }),
          });
        });
        throw new AppError("SERVICE_UNAVAILABLE", undefined, { cause: err });
      }

      return { mealId: id, status: "processing" };
    },

    async get(userId, mealId) {
      const meal = await MealModel.findOne(
        { _id: mealId, userId },
        MEAL_RESPONSE_FIELDS,
      ).lean<StoredMeal>();
      if (!meal) throw new AppError("NOT_FOUND");
      return toMealResponse(meal, await media.signedUrl(meal.media.photoKey));
    },

    async correct(userId, mealId, input) {
      for (let attempt = 0; attempt < MAX_CORRECT_ATTEMPTS; attempt++) {
        const meal = await MealModel.findOne(
          { _id: mealId, userId },
          MEAL_RESPONSE_FIELDS,
        ).lean<StoredMeal>();
        if (!meal) throw new AppError("NOT_FOUND");
        // En processing o failed no hay análisis que corregir.
        if (meal.status !== "ready") throw new AppError("MEAL_NOT_READY");
        if (!meal.analysis) throw new Error(`La comida ${mealId} está ready sin análisis`);

        // El from es el valor que ve el usuario, con las correcciones anteriores aplicadas.
        const current = applyCorrections(meal.analysis, meal.corrections);
        const at = now();
        const corrections = CORRECTABLE_FIELDS.flatMap((field) => {
          const to = input[field];
          if (to === undefined || isDeepStrictEqual(to, current[field])) return [];
          return [{ field, from: current[field], to, at }];
        });
        if (corrections.length === 0) {
          return {
            meal: toMealResponse(meal, await media.signedUrl(meal.media.photoKey)),
            fields: [],
          };
        }

        // Optimista: si otro PATCH agregó correcciones desde que leímos, el from quedó viejo.
        const updated = await MealModel.findOneAndUpdate(
          {
            _id: mealId,
            userId,
            status: "ready",
            corrections: { $size: meal.corrections.length },
          },
          { $push: { corrections: { $each: corrections } } },
          { new: true, projection: MEAL_RESPONSE_FIELDS },
        ).lean<StoredMeal>();
        if (updated) {
          return {
            meal: toMealResponse(updated, await media.signedUrl(updated.media.photoKey)),
            fields: corrections.map(({ field }) => field),
          };
        }
      }
      throw new AppError("INTERNAL_ERROR", undefined, {
        cause: new Error(`La comida cambió ${MAX_CORRECT_ATTEMPTS} veces durante el PATCH`),
      });
    },
  };
}

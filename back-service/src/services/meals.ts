import { isDeepStrictEqual } from "node:util";
import { Types } from "mongoose";
import { AppError, MEALS_PAGE_SIZE, serializeError } from "@caloria/shared";
import type {
  CorrectableField,
  CorrectMealInput,
  CreateMealResponse,
  Logger,
  MealErrorCode,
  MealListResponse,
  MealResponse,
  ValidMealUpload,
} from "@caloria/shared";
import type { MealAnalysisQueue } from "../jobs/meal-analysis";
import { MealModel } from "../models/Meal";
import type { MealMedia } from "../models/Meal";
import { UserModel } from "../models/User";
import type { User } from "../models/User";
import { localDateIn } from "./local-date";
import { applyCorrections, toMealSearch } from "./meal-corrections";
import { MEAL_RESPONSE_FIELDS, toMealResponse } from "./meal-response";
import type { MealResponseSource } from "./meal-response";
import type { MediaKind, MediaService } from "./media";
import { createStreakService } from "./streak";
import type { StreakService } from "./streak";

export const ENQUEUE_FAILED = "ENQUEUE_FAILED" satisfies MealErrorCode;

const MAX_CORRECT_ATTEMPTS = 3;
// Tope de espera por la racha para no pasar del segundo de respuesta (RNF-01).
export const STREAK_TIMEOUT_MS = 300;
const CORRECTABLE_FIELDS = [
  "dish",
  "items",
  "kcal",
  "macros",
] as const satisfies CorrectableField[];

type StoredMeal = MealResponseSource & { media: Pick<MealMedia, "photoKey"> };

/** Posición en el historial: la última comida de la página anterior, en el orden del listado. */
interface ListCursor {
  capturedAt: Date;
  id: Types.ObjectId;
}

// Opaco para la app: base64url de "<capturedAt en ms>.<id>".
function encodeCursor({ capturedAt, _id }: Pick<StoredMeal, "capturedAt" | "_id">): string {
  return Buffer.from(`${capturedAt.getTime()}.${_id.toString()}`).toString("base64url");
}

function decodeCursor(cursor: string): ListCursor {
  const match = /^(\d{1,15})\.([0-9a-f]{24})$/.exec(Buffer.from(cursor, "base64url").toString());
  if (!match) throw new AppError("VALIDATION_ERROR", "El cursor no es válido");
  return { capturedAt: new Date(Number(match[1])), id: new Types.ObjectId(match[2]) };
}

export interface CorrectMealResult {
  meal: MealResponse;
  /** Campos que cambiaron y quedaron en `corrections`; vacío si no cambió nada. */
  fields: CorrectableField[];
}

export interface CreateMealContext {
  requestId: string;
  log: Logger;
}

export interface RemoveMealContext {
  log: Logger;
}

export interface MealService {
  create(
    userId: string,
    upload: ValidMealUpload,
    context: CreateMealContext,
  ): Promise<CreateMealResponse>;
  get(userId: string, mealId: string): Promise<MealResponse>;
  /** Comidas del día (`localDate`) por hora ascendente, de a MEALS_PAGE_SIZE. */
  list(userId: string, date: string, cursor?: string): Promise<MealListResponse>;
  /** Borra la media y después el documento. Lanza NOT_FOUND si no es del usuario. */
  remove(userId: string, mealId: string, context: RemoveMealContext): Promise<void>;
  correct(userId: string, mealId: string, input: CorrectMealInput): Promise<CorrectMealResult>;
}

export interface MealServiceDeps {
  media: MediaService;
  queue: MealAnalysisQueue;
  streak?: StreakService;
  now?: () => Date;
}

export function createMealService({
  media,
  queue,
  streak = createStreakService(),
  now = () => new Date(),
}: MealServiceDeps): MealService {
  /**
   * La racha nunca rompe el registro: si falla se loguea, y si tarda más de STREAK_TIMEOUT_MS se
   * responde sin esperarla (la escritura sigue y es atómica). Nunca rechaza.
   */
  async function recordStreak(userId: string, localDate: string, log: Logger, mealId: string) {
    const update = streak.record(userId, localDate).then(
      () => true,
      (err: unknown) => {
        log.error("no se pudo actualizar la racha", {
          mealId,
          err: serializeError(err, { stack: true }),
        });
        return true;
      },
    );
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), STREAK_TIMEOUT_MS);
    });
    const settled = await Promise.race([update, timeout]);
    clearTimeout(timer);
    if (!settled) log.warn("la racha tarda; se responde sin esperarla", { mealId });
  }

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
      const localDate = localDateIn(user.profile.timezone, receivedAt);

      try {
        await MealModel.create({
          _id: mealId,
          userId,
          capturedAt: receivedAt,
          localDate,
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

      // Cuenta el registro, no el análisis: la comida ya está guardada aunque después falle.
      // Va en paralelo con el encolado.
      const streakRecorded = recordStreak(userId, localDate, log, id);
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
      await streakRecorded;

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

    async list(userId, date, cursor) {
      const after = cursor === undefined ? undefined : decodeCursor(cursor);
      // Mismo orden que el índice { userId, localDate, capturedAt, _id }: el _id desempata.
      const meals = await MealModel.find(
        {
          userId,
          localDate: date,
          ...(after && {
            $or: [
              { capturedAt: { $gt: after.capturedAt } },
              { capturedAt: after.capturedAt, _id: { $gt: after.id } },
            ],
          }),
        },
        MEAL_RESPONSE_FIELDS,
      )
        .sort({ capturedAt: 1, _id: 1 })
        .limit(MEALS_PAGE_SIZE + 1)
        .lean<StoredMeal[]>();
      const page = meals.slice(0, MEALS_PAGE_SIZE);
      const items = await Promise.all(
        page.map(async (meal) => toMealResponse(meal, await media.signedUrl(meal.media.photoKey))),
      );
      const last = page.at(-1);
      return {
        items,
        nextCursor: meals.length > MEALS_PAGE_SIZE && last ? encodeCursor(last) : null,
      };
    },

    async remove(userId, mealId, { log }) {
      const meal = await MealModel.findOne({ _id: mealId, userId }, { media: 1 }).lean<{
        media: MealMedia;
      }>();
      if (!meal) throw new AppError("NOT_FOUND");

      // Primero la media: si el bucket falla, la comida sigue y el usuario reintenta (borrar es
      // idempotente). Al revés, un 204 podría dejar la foto en el bucket sin nada que la apunte.
      const keys = [meal.media.photoKey, ...(meal.media.audioKey ? [meal.media.audioKey] : [])];
      const results = await Promise.allSettled(keys.map((key) => media.remove(key)));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) {
        log.error("no se pudo borrar la media; la comida no se borra", {
          mealId,
          err: serializeError(failed.reason, { stack: true }),
        });
        throw new AppError("SERVICE_UNAVAILABLE", undefined, { cause: failed.reason });
      }

      // Si ya no está (otro DELETE ganó la carrera), el resultado es el mismo: no existe más.
      await MealModel.deleteOne({ _id: mealId, userId });
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

        // El índice de similares tiene que ver los valores finales, no los de la IA.
        const search = toMealSearch(
          applyCorrections(meal.analysis, [...meal.corrections, ...corrections]),
        );
        // Optimista: si otro PATCH agregó correcciones desde que leímos, el from quedó viejo.
        const updated = await MealModel.findOneAndUpdate(
          {
            _id: mealId,
            userId,
            status: "ready",
            corrections: { $size: meal.corrections.length },
          },
          { $push: { corrections: { $each: corrections } }, $set: { search } },
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

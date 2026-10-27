import type { RequestHandler } from "express";
import {
  AppError,
  AUDIO_MAX_SECONDS,
  correctMealSchema,
  listMealsQuerySchema,
  mealIdParamsSchema,
  validateMealUpload,
} from "@caloria/shared";
import { userIdOf } from "../middleware/auth";
import { mp4DurationSeconds } from "../services/audio-duration";
import type { MealService } from "../services/meals";

// El grabador corta a los 60 s, pero el AAC puede sumar unos ms de relleno al final.
const AUDIO_DURATION_TOLERANCE_SECONDS = 0.5;

type MulterFiles = Partial<Record<"photo" | "audio", Express.Multer.File[]>>;

export function mealsController(
  meals: MealService,
): Record<"create" | "list" | "get" | "patch" | "remove", RequestHandler> {
  return {
    async create(req, res) {
      const start = performance.now();
      const files = req.files as MulterFiles | undefined;
      const upload = validateMealUpload({
        photo: files?.photo?.[0],
        audio: files?.audio?.[0],
        fields: req.body,
      });
      if (upload.audio) {
        const seconds = mp4DurationSeconds(upload.audio.buffer);
        if (seconds === undefined) {
          throw new AppError("VALIDATION_ERROR", "No se pudo leer la duración del audio");
        }
        if (seconds > AUDIO_MAX_SECONDS + AUDIO_DURATION_TOLERANCE_SECONDS) {
          throw new AppError("VALIDATION_ERROR", `El audio dura más de ${AUDIO_MAX_SECONDS} s`);
        }
      }

      const result = await meals.create(userIdOf(res), upload, {
        requestId: req.requestId,
        log: req.log,
      });
      req.log.info("comida encolada", {
        mealId: result.mealId,
        durationMs: Math.round(performance.now() - start),
      });
      res.status(202).json(result);
    },

    async list(req, res) {
      res.set("Cache-Control", "no-store");
      const { date, cursor } = listMealsQuerySchema.parse(req.query);
      res.json(await meals.list(userIdOf(res), date, cursor));
    },

    async get(req, res) {
      res.set("Cache-Control", "no-store");
      const { id } = mealIdParamsSchema.parse(req.params);
      res.json(await meals.get(userIdOf(res), id));
    },

    async patch(req, res) {
      const start = performance.now();
      res.set("Cache-Control", "no-store");
      const { id } = mealIdParamsSchema.parse(req.params);
      const input = correctMealSchema.parse(req.body);
      const { meal, fields } = await meals.correct(userIdOf(res), id, input);
      // Solo qué campos cambiaron: los valores no van al log.
      req.log.info("comida corregida", {
        mealId: id,
        fields,
        durationMs: Math.round(performance.now() - start),
      });
      res.json(meal);
    },

    async remove(req, res) {
      const { id } = mealIdParamsSchema.parse(req.params);
      await meals.remove(userIdOf(res), id, { log: req.log });
      req.log.info("comida borrada", { mealId: id });
      res.status(204).end();
    },
  };
}

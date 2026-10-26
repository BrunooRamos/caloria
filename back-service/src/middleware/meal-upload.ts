import multer from "multer";
import { MEAL_UPLOAD_FIELDS, MEAL_UPLOAD_LIMITS } from "@caloria/shared";

export const mealUpload = multer({
  storage: multer.memoryStorage(),
  limits: MEAL_UPLOAD_LIMITS,
}).fields(MEAL_UPLOAD_FIELDS);

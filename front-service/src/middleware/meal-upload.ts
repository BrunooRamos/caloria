import multer from "multer";
import { MEAL_UPLOAD_FIELDS, MEAL_UPLOAD_LIMITS } from "@caloria/shared";

// El Front es stateless: el multipart se procesa en memoria con límites y nunca toca el disco.
export const mealUpload = multer({
  storage: multer.memoryStorage(),
  limits: MEAL_UPLOAD_LIMITS,
}).fields(MEAL_UPLOAD_FIELDS);

import { File } from "expo-file-system";
import type { PreparedPhoto } from "./prepare-photo";

/** Lo que se manda en `POST /meals`. */
export interface MealDraft {
  photo: PreparedPhoto;
}

export function buildMealForm({ photo }: MealDraft): FormData {
  const form = new FormData();
  form.append("photo", new File(photo.uri));
  return form;
}

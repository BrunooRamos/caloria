import { File } from "expo-file-system";
import type { AudioNote } from "./useAudioNote";
import type { PreparedPhoto } from "./prepare-photo";

/** Lo que se manda en `POST /meals`. */
export interface MealDraft {
  photo: PreparedPhoto;
  audio?: AudioNote;
}

export function buildMealForm({ photo, audio }: MealDraft): FormData {
  const form = new FormData();
  form.append("photo", new File(photo.uri));
  if (audio) form.append("audio", new File(audio.uri));
  return form;
}

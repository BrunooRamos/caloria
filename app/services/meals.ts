import { api } from "./api";

export interface CreateMealResponse {
  mealId: string;
  status: "processing";
}

/** `POST /meals` multipart: sin Content-Type a mano, el boundary lo arma fetch. */
export function createMeal(form: FormData): Promise<CreateMealResponse> {
  return api.post<CreateMealResponse>("/meals", form);
}

export interface Range {
  min: number;
  max: number;
}

export interface MealItem {
  name: string;
  grams: Range;
  kcal: Range;
}

interface MealBase {
  id: string;
  capturedAt: string;
  photoUrl: string;
}

export interface ProcessingMeal extends MealBase {
  status: "processing";
}

export interface ReadyMeal extends MealBase {
  status: "ready";
  dish: string;
  items: MealItem[];
  kcal: Range;
  macros: { protein: Range; carbs: Range; fat: Range };
  confidence: number;
  comment?: { tone: string; text: string };
}

export interface FailedMeal extends MealBase {
  status: "failed";
  /** `NOT_FOOD`, `ENQUEUE_FAILED`, `ANALYSIS_FAILED` o uno que esta versión de la app no conoce. */
  error: { code: string };
}

/** `GET /meals/:id`, según el `status`. */
export type Meal = ProcessingMeal | ReadyMeal | FailedMeal;

export function getMeal(id: string, signal?: AbortSignal): Promise<Meal> {
  return api.get<Meal>(`/meals/${encodeURIComponent(id)}`, { signal });
}

/**
 * `GET /meals?date=&cursor=`: una página (hasta 20) de las comidas de un día, de la más temprana a
 * la más tardía, cada una con la misma forma que `GET /meals/:id`. `nextCursor` es opaco y viene
 * en `null` cuando no hay más. Espejo de `MealListResponse` en `@caloria/shared`.
 */
export interface MealListResponse {
  items: Meal[];
  nextCursor: string | null;
}

/** `date` es `YYYY-MM-DD`: el día en la zona del usuario. */
export function listMealsByDay(
  date: string,
  cursor?: string | null,
  signal?: AbortSignal,
): Promise<MealListResponse> {
  // A mano y no con URLSearchParams: en React Native no está completo.
  let query = `date=${encodeURIComponent(date)}`;
  if (cursor) query += `&cursor=${encodeURIComponent(cursor)}`;
  return api.get<MealListResponse>(`/meals?${query}`, { signal });
}

/** `DELETE /meals/:id`: 204 sin cuerpo; 404 si no existe o es de otro usuario. */
export function deleteMeal(id: string): Promise<void> {
  return api.delete(`/meals/${encodeURIComponent(id)}`);
}

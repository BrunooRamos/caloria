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

/** Lo que se puede corregir de una comida lista. */
export type MealValues = Pick<ReadyMeal, "dish" | "items" | "kcal" | "macros">;

/** Body de `PATCH /meals/:id`: los campos que cambiaron, cada uno completo. */
export type MealCorrection = Partial<MealValues>;

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

/** `PATCH /meals/:id`: devuelve la comida con las correcciones aplicadas. */
export function correctMeal(id: string, body: MealCorrection): Promise<ReadyMeal> {
  return api.patch<ReadyMeal>(`/meals/${encodeURIComponent(id)}`, body);
}

import { api } from "./api";

export interface CreateMealResponse {
  mealId: string;
  status: "processing";
}

/** `POST /meals` multipart: sin Content-Type a mano, el boundary lo arma fetch. */
export function createMeal(form: FormData): Promise<CreateMealResponse> {
  return api.post<CreateMealResponse>("/meals", form);
}

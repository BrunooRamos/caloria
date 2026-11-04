import { z } from "zod";
import type { ZodType } from "zod";
import {
  correctMealSchema,
  dailyDashboardQuerySchema,
  listMealsQuerySchema,
  loginSchema,
  logoutSchema,
  mealIdParamsSchema,
  refreshSchema,
  registerSchema,
  weeklySummaryParamsSchema,
} from "@caloria/shared";
import { withoutOperatorKeys } from "./safe-keys";
import { updateMeRequestSchema } from "./users";

/** Sin params ni query: cualquier campo de más es un 400. */
const none = z.object({}).strict();

export interface RouteSchema {
  body?: ZodType;
  params: ZodType;
  query: ZodType;
}

function route({ body, params = none, query = none }: Partial<RouteSchema>): RouteSchema {
  return {
    body: body && withoutOperatorKeys(body),
    params: withoutOperatorKeys(params),
    query: withoutOperatorKeys(query),
  };
}

export const schemas = {
  register: route({ body: registerSchema }),
  login: route({ body: loginSchema }),
  refresh: route({ body: refreshSchema }),
  logout: route({ body: logoutSchema }),
  getMe: route({}),
  updateMe: route({ body: updateMeRequestSchema }),
  deleteMe: route({}),
  // El body es multipart: lo valida validateMealUpload después de multer.
  createMeal: route({}),
  listMeals: route({ query: listMealsQuerySchema }),
  getMeal: route({ params: mealIdParamsSchema }),
  correctMeal: route({ params: mealIdParamsSchema, body: correctMealSchema }),
  deleteMeal: route({ params: mealIdParamsSchema }),
  getDailyDashboard: route({ query: dailyDashboardQuerySchema }),
  getWeeklySummary: route({ params: weeklySummaryParamsSchema }),
} satisfies Record<string, RouteSchema>;

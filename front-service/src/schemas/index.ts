import { z } from "zod";
import type { ZodType } from "zod";
import { loginSchema, refreshSchema, registerSchema, updateMeSchema } from "@caloria/shared";

/** Sin params ni query: cualquier campo de más es un 400. */
const none = z.object({}).strict();

export interface RouteSchema {
  body?: ZodType;
  params: ZodType;
  query: ZodType;
}

export const schemas = {
  register: { body: registerSchema, params: none, query: none },
  login: { body: loginSchema, params: none, query: none },
  refresh: { body: refreshSchema, params: none, query: none },
  logout: { body: refreshSchema, params: none, query: none },
  getMe: { params: none, query: none },
  updateMe: { body: updateMeSchema, params: none, query: none },
  deleteMe: { params: none, query: none },
} satisfies Record<string, RouteSchema>;

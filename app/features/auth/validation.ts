import { z } from "zod";

export const EMAIL_MAX_CHARS = 254;
export const PASSWORD_MIN_CHARS = 8;
export const PASSWORD_MAX_BYTES = 72;

export type FormValues<F extends string> = Record<F, string>;
export type FormErrors<F extends string> = Partial<Record<F, string>>;
export type FormSchema<F extends string, Out = FormValues<F>> = z.ZodType<Out, FormValues<F>>;

export type LoginField = "email" | "password";
export type RegisterField = LoginField | "confirmPassword";

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;
const chars = (value: string) => [...value].length;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, { error: "Ingresá tu email.", abort: true })
  .pipe(
    z
      .email({ error: "Revisá el email: no parece válido." })
      .max(EMAIL_MAX_CHARS, { error: "Ese email es demasiado largo." }),
  );

const passwordNotTooLong = (value: string) => utf8Bytes(value) <= PASSWORD_MAX_BYTES;
const TOO_LONG = { error: "La contraseña es demasiado larga." };

export const loginSchema: FormSchema<LoginField> = z.object({
  email,
  password: z
    .string()
    .min(1, { error: "Ingresá tu contraseña.", abort: true })
    .refine(passwordNotTooLong, TOO_LONG),
});

const registerFields = z.object({
  email,
  password: z
    .string()
    .min(1, { error: "Elegí una contraseña.", abort: true })
    .refine((value) => chars(value) >= PASSWORD_MIN_CHARS, {
      error: `Usá al menos ${PASSWORD_MIN_CHARS} caracteres.`,
      abort: true,
    })
    .refine(passwordNotTooLong, TOO_LONG),
  confirmPassword: z.string().min(1, { error: "Repetí la contraseña." }),
});

const passwords = registerFields.pick({ password: true, confirmPassword: true });

export const registerSchema: FormSchema<RegisterField> = registerFields.refine(
  (values) => values.password === values.confirmPassword,
  {
    error: "Las contraseñas no coinciden.",
    path: ["confirmPassword"],
    when: (payload) => passwords.safeParse(payload.value).success,
  },
);

export type ValidationResult<F extends string, Out = FormValues<F>> =
  { ok: true; data: Out } | { ok: false; errors: FormErrors<F> };

function isField<F extends string>(key: PropertyKey | undefined, values: FormValues<F>): key is F {
  return typeof key === "string" && key in values;
}

export function validateForm<F extends string, Out>(
  schema: FormSchema<F, Out>,
  values: FormValues<F>,
): ValidationResult<F, Out> {
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };

  const errors: FormErrors<F> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (isField(field, values) && errors[field] === undefined) errors[field] = issue.message;
  }
  return { ok: false, errors };
}

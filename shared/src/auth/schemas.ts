import { z } from "zod";

/** bcrypt ignora lo que pasa de 72 bytes: más largo no se acepta. */
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_MIN_CHARS = 8;

/** trim + minúsculas antes de validar, así lo que se guarda y se compara es siempre lo mismo. */
export const emailSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.email().max(254),
);

export const passwordSchema = z
  .string()
  .refine((value) => [...value].length >= PASSWORD_MIN_CHARS, {
    message: `Mínimo ${PASSWORD_MIN_CHARS} caracteres`,
  })
  .refine((value) => Buffer.byteLength(value, "utf8") <= PASSWORD_MAX_BYTES, {
    message: `Máximo ${PASSWORD_MAX_BYTES} bytes`,
  });

/** Edad cumplida en `today` para una fecha "YYYY-MM-DD". */
export function ageOn(birthDate: string, today: Date): number {
  const [year, month, day] = birthDate.split("-").map(Number);
  let age = today.getUTCFullYear() - year;
  const beforeBirthday =
    today.getUTCMonth() + 1 < month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const profileSchema = z.object({
  sex: z.enum(["female", "male"]),
  birthDate: z.iso.date().refine(
    (value) => {
      const age = ageOn(value, new Date());
      return age >= 16 && age <= 100;
    },
    { message: "La edad tiene que estar entre 16 y 100 años" },
  ),
  heightCm: z.number().min(100).max(250),
  weightKg: z.number().min(30).max(300),
  activity: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
  goal: z.enum(["lose", "maintain", "gain"]),
  timezone: z.string().refine(isTimeZone, { message: "Zona horaria inválida" }),
});

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  profile: profileSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1)
    .refine((value) => Buffer.byteLength(value, "utf8") <= PASSWORD_MAX_BYTES, {
      message: `Máximo ${PASSWORD_MAX_BYTES} bytes`,
    }),
});

export const updateMeSchema = z
  .object({
    profile: profileSchema
      .partial()
      .strict()
      .refine((profile) => Object.keys(profile).length > 0, {
        message: "Indicá al menos un dato del perfil",
      }),
  })
  .strict();

export type Profile = z.infer<typeof profileSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
}

export interface MeResponse {
  id: string;
  email: string;
  profile: Profile;
  targets: { kcal: number; proteinG: number; carbsG: number; fatG: number };
  tone: "motivador" | "neutro" | "roast" | "off";
  plan: { tier: "free" | "premium"; since: string; renewsAt?: string };
}

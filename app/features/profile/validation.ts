import { z } from "zod";
import type { Profile } from "@/services/auth";
import type { FormSchema, FormValues } from "@/features/auth/validation";

export const AGE_RANGE = { min: 16, max: 100 } as const;
export const HEIGHT_CM_RANGE = { min: 100, max: 250 } as const;
export const WEIGHT_KG_RANGE = { min: 30, max: 300 } as const;

export const SEXES = ["female", "male"] as const;
export const ACTIVITIES = ["sedentary", "light", "moderate", "active", "very_active"] as const;
export const GOALS = ["lose", "maintain", "gain"] as const;

export type ProfileInput = Omit<Profile, "timezone">;
export type ProfileField = keyof ProfileInput;
export type ProfileValues = FormValues<ProfileField>;

export const EMPTY_PROFILE: ProfileValues = {
  sex: "",
  birthDate: "",
  heightCm: "",
  weightKg: "",
  activity: "",
  goal: "",
};

export function ageOn(birthDate: string, today: Date): number {
  const [year, month, day] = birthDate.split("-").map(Number);
  let age = today.getUTCFullYear() - year;
  const beforeBirthday =
    today.getUTCMonth() + 1 < month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

export function birthDatePicker(today = new Date()) {
  const [year, month, day] = [today.getFullYear(), today.getMonth(), today.getDate()];
  return {
    minimumDate: new Date(year - AGE_RANGE.max - 1, month, day + 1),
    maximumDate: new Date(year - AGE_RANGE.min, month, day),
    initialDate: new Date(year - 25, 0, 1),
  };
}

const NUMBER = /^\d{1,3}([.,]\d{1,2})?$/;

function measure(name: string, unit: string, { min, max }: { min: number; max: number }) {
  return z
    .string()
    .trim()
    .min(1, { error: `Ingresá tu ${name}.`, abort: true })
    .regex(NUMBER, { error: `Ingresá tu ${name} en ${unit}, solo con números.`, abort: true })
    .transform((value) => Number(value.replace(",", ".")))
    .pipe(
      z
        .number()
        .min(min, { error: `Tiene que estar entre ${min} y ${max} ${unit}.` })
        .max(max, { error: `Tiene que estar entre ${min} y ${max} ${unit}.` }),
    );
}

const choice = <T extends readonly [string, ...string[]]>(options: T, error: string) =>
  z.string().pipe(z.enum(options, { error }));

const fields = {
  sex: choice(SEXES, "Elegí una opción."),
  birthDate: z
    .string()
    .min(1, { error: "Elegí tu fecha de nacimiento.", abort: true })
    .pipe(z.iso.date({ error: "Elegí tu fecha de nacimiento.", abort: true }))
    .refine(
      (value) => {
        const age = ageOn(value, new Date());
        return age >= AGE_RANGE.min && age <= AGE_RANGE.max;
      },
      { error: `CalorIA es para personas de ${AGE_RANGE.min} a ${AGE_RANGE.max} años.` },
    ),
  heightCm: measure("altura", "cm", HEIGHT_CM_RANGE),
  weightKg: measure("peso", "kg", WEIGHT_KG_RANGE),
  activity: choice(ACTIVITIES, "Elegí tu nivel de actividad."),
  goal: choice(GOALS, "Elegí tu objetivo."),
};

type Step<F extends ProfileField> = FormSchema<F, Pick<ProfileInput, F>>;

export const aboutYouSchema: Step<"sex" | "birthDate"> = z.object({
  sex: fields.sex,
  birthDate: fields.birthDate,
});

export const measuresSchema: Step<"heightCm" | "weightKg"> = z.object({
  heightCm: fields.heightCm,
  weightKg: fields.weightKg,
});

export const routineSchema: Step<"activity" | "goal"> = z.object({
  activity: fields.activity,
  goal: fields.goal,
});

export const profileSchema: FormSchema<ProfileField, ProfileInput> = z.object(fields);

export function profileToValues(profile: Profile): ProfileValues {
  const decimal = (value: number) => String(value).replace(".", ",");
  return {
    sex: profile.sex,
    birthDate: profile.birthDate,
    heightCm: decimal(profile.heightCm),
    weightKg: decimal(profile.weightKg),
    activity: profile.activity,
    goal: profile.goal,
  };
}

export function changedFields(saved: Profile, next: ProfileInput): Partial<ProfileInput> {
  const changes: Partial<Record<ProfileField, unknown>> = {};
  for (const key of Object.keys(next) as ProfileField[]) {
    if (next[key] !== saved[key]) changes[key] = next[key];
  }
  return changes as Partial<ProfileInput>;
}
